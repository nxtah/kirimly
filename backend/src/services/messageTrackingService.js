/**
 * messageTrackingService.js
 *
 * Attaches Baileys event listeners per socket for delivery/read/reply tracking.
 * Listeners are registered in waSessionManager when a socket is created or restored.
 *
 * ── Trade-off notes ──
 * 'replied' detection via messages.upsert is inherently best-effort:
 *   - False positive: contact replies to an unrelated message (not the blast)
 *     within the 24h window — we see the phone number match and mark replied.
 *   - False negative: contact sends a new message to a different chat that we
 *     don't have, or the 24h window expired.
 *   - Accuracy improves with shorter windows but misses slow replies.
 */

const { isLidUser } = require('@whiskeysockets/baileys');
const pool = require('../config/database');

// Batch-flush buffer: accumulate updates per userId and flush periodically
const flushQueues = new Map();   // userId → [{ waMsgId, status }]
const FLUSH_INTERVAL_MS = 2000; // flush every 2s

/* ─────────────────── helpers ─────────────────── */

/**
 * Map WAMessageStatus to our status string + column name.
 *   WAMessageStatus: 0=ERROR, 1=PENDING, 2=SERVER_ACK,
 *                     3=DELIVERY_ACK, 4=READ
 */
function mapStatus(waStatus) {
  switch (waStatus) {
    case 3: return { status: 'delivered', col: 'delivered_at' };
    case 4: return { status: 'read',      col: 'read_at' };
    default: return null; // PENDING, ERROR, SERVER_ACK — ignore
  }
}

/* ─────────────────── batched DB flush ─────────────────── */

/**
 * Enqueue a status update into the batch buffer.
 * Flushes every FLUSH_INTERVAL_MS to reduce DB round-trips.
 */
function enqueueUpdate(userId, waMsgId, status, timestamp) {
  if (!flushQueues.has(userId)) {
    flushQueues.set(userId, []);
  }
  flushQueues.get(userId).push({ waMsgId, status, timestamp });
}

async function flushQueue(userId) {
  const batch = flushQueues.get(userId);
  if (!batch || batch.length === 0) return;

  flushQueues.set(userId, []);

  // Group by status column for batch update
  const byCol = {};
  for (const item of batch) {
    const key = item.status.col;
    if (!byCol[key]) byCol[key] = { col: key, items: [] };
    byCol[key].items.push(item);
  }

  for (const group of Object.values(byCol)) {
    const { col, items } = group;
    const ids = items.map((i) => i.waMsgId);
    const ts = items[0].timestamp; // all in same batch ≈ same time

    // A read receipt implies delivery, so backfill delivered_at when it is missing.
    const backfillDelivered = col === 'read_at' ? 'delivered_at = COALESCE(delivered_at, $2),' : '';

    await pool.query(
      `UPDATE blast_messages
       SET status = CASE
         WHEN status IN ('sent', 'delivered') THEN $1
         ELSE status
       END,
       ${backfillDelivered}
       ${col} = COALESCE(${col}, $2)
       WHERE wa_message_id = ANY($3::text[])
         AND wa_message_id IS NOT NULL`,
      [col.replace('_at', ''), ts, ids]
    );
  }

  const { rows: touched } = await pool.query(
    `SELECT DISTINCT blast_id FROM blast_messages WHERE wa_message_id = ANY($1::text[])`,
    [batch.map((i) => i.waMsgId)]
  );
  await recountAggregates(userId, touched.map((r) => r.blast_id));
}

/**
 * Recompute blasts.delivered_count/read_count from blast_messages for the given
 * blast ids (cumulative: a read message is also delivered). Shared by the
 * delivery/read flush above and by handlePotentialReply below, so both paths
 * that can set delivered_at/read_at keep the aggregate counters consistent.
 */
async function recountAggregates(userId, blastIds) {
  if (blastIds.length === 0) return;
  await pool.query(
    `UPDATE blasts b
     SET delivered_count = s.delivered,
         read_count      = s.read,
         updated_at      = NOW()
     FROM (
       SELECT blast_id,
              COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered,
              COUNT(*) FILTER (WHERE read_at IS NOT NULL)::int      AS read
       FROM blast_messages
       WHERE blast_id = ANY($1::int[])
       GROUP BY blast_id
     ) s
     WHERE b.id = s.blast_id AND b.user_id = $2`,
    [blastIds, userId]
  );
}

// Periodic flush for all non-empty queues (snapshot keys to avoid live-iterator races)
setInterval(() => {
  for (const userId of [...flushQueues.keys()]) {
    flushQueue(userId).catch((err) => {
      console.error(`Flush queue error for user ${userId}:`, err);
    });
  }
}, FLUSH_INTERVAL_MS).unref();

/* ─────────────────── event listeners ─────────────────── */

/**
 * Attach messages.update handler — delivery & read receipts.
 * Baileys emits { updates: [{ key: { id, remoteJid, fromMe }, update: { status } }] }
 */
function attachMessagesUpdate(socket, userId) {
  socket.ev.on('messages.update', (updates) => {
    try {
      for (const { key, update } of updates) {
        // Only care about our own outgoing messages
        if (!key?.fromMe) continue;
        if (!key?.id) continue;

        const mapped = mapStatus(update?.status);
        if (!mapped) continue;

        enqueueUpdate(userId, key.id, mapped, new Date().toISOString());
      }
    } catch (err) {
      console.error(`User ${userId} messages.update handler error:`, err);
    }
  });
}

/**
 * Turn a message's JID into a plain phone number, even when WhatsApp addresses
 * the chat by "LID" (a privacy-preserving identifier some chats now use)
 * instead of a phone-number JID (`<phone>@s.whatsapp.net`). Without this,
 * replies from a LID-addressed chat would be silently ignored (a real gap,
 * not just "no reply yet") — WhatsApp does not always tell us up-front which
 * addressing mode a given chat is using.
 *
 * Resolution order:
 *   1. remoteJid is already a phone-number JID — use it directly (fast path,
 *      covers the vast majority of contacts).
 *   2. Baileys already resolved the LID for us on the message itself
 *      (`key.remoteJidAlt` / `key.participantAlt`) — no lookup needed.
 *   3. Otherwise, ask Baileys' own LID↔phone-number mapping store
 *      (`socket.signalRepository.lidMapping`, populated as WhatsApp reveals
 *      mappings over time) — may still be unknown for a brand-new LID chat,
 *      in which case we give up quietly rather than guess.
 */
async function resolvePhoneNumber(socket, msg) {
  const remoteJid = msg.key?.remoteJid;
  if (!remoteJid) return null;

  const stripDevice = (jid) => jid.split('@')[0].split(':')[0];

  if (remoteJid.includes('@s.whatsapp.net')) {
    return stripDevice(remoteJid);
  }

  const alt = msg.key?.remoteJidAlt || msg.key?.participantAlt;
  if (alt && alt.includes('@s.whatsapp.net')) {
    return stripDevice(alt);
  }

  if (isLidUser(remoteJid) && socket?.signalRepository?.lidMapping) {
    try {
      const pn = await socket.signalRepository.lidMapping.getPNForLID(remoteJid);
      if (pn) return stripDevice(pn);
    } catch {
      // No mapping known yet for this LID — nothing more we can do for this message.
    }
  }

  return null;
}

/**
 * Attach messages.upsert handler — detect replies from contacts.
 * Baileys emits { messages: [proto.WebMessageInfo], type: 'notify' }
 *
 * Checks if the incoming message's sender has an outgoing blast_message
 * within the last 24 hours. If so, marks that message as 'replied'.
 */
function attachMessagesUpsert(socket, userId) {
  socket.ev.on('messages.upsert', ({ messages, type } = {}) => {
    try {
      if (type !== 'notify') return; // ignore sync/historical messages

      for (const msg of messages) {
        // Only incoming messages from other people
        if (msg.key?.fromMe) continue;
        if (!msg.key?.remoteJid) continue;

        const replyBody =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          null;

        // Run async but don't block the event loop
        resolvePhoneNumber(socket, msg).then((phoneNumber) => {
          if (!phoneNumber) return;
          return handlePotentialReply(userId, phoneNumber, replyBody);
        }).catch((err) => {
          console.error(`Reply detection error user=${userId}:`, err);
        });
      }
    } catch (err) {
      console.error(`User ${userId} messages.upsert handler error:`, err);
    }
  });
}

/**
 * Look up recent blast_messages for this phone number and mark as replied.
 */
async function handlePotentialReply(userId, phoneNumber, replyBody) {
  // Find latest blast_message to this phone that hasn't been replied yet
  // Only consider blasts from the last 24 hours
  const { rows } = await pool.query(
    `SELECT bm.id, bm.status, bm.blast_id
     FROM blast_messages bm
     JOIN blasts b ON b.id = bm.blast_id
     WHERE bm.phone_number = $1
       AND b.user_id = $2
       AND b.status IN ('sending', 'completed')
       AND b.created_at > NOW() - INTERVAL '24 hours'
       AND bm.status IN ('sent', 'delivered', 'read')
       AND bm.replied_at IS NULL
     ORDER BY bm.sent_at DESC NULLS LAST
     LIMIT 1`,
    [phoneNumber, userId]
  );

  if (rows.length === 0) return; // no matching blast message

  const bm = rows[0];

  // A reply proves the contact received AND read the message, regardless of
  // whether WhatsApp ever sent us delivery/read receipts for it (the recipient
  // may have "Read Receipts" turned off in their own privacy settings — that
  // only suppresses the blue-tick *signal* back to us, it doesn't mean they
  // didn't read it). So backfill delivered_at/read_at here too (only forward,
  // never overwriting an earlier real timestamp) — nested: replied ⟹ read ⟹ delivered.
  await pool.query(
    `UPDATE blast_messages
     SET status = 'replied', replied_at = NOW(), reply_body = COALESCE($1, reply_body),
         delivered_at = COALESCE(delivered_at, NOW()),
         read_at = COALESCE(read_at, NOW())
     WHERE id = $2 AND replied_at IS NULL`,
    [replyBody, bm.id]
  );

  // Update aggregate counters on blast (replied_count is a simple increment;
  // delivered/read may have just been backfilled above, so recount those too).
  await pool.query(
    `UPDATE blasts SET replied_count = replied_count + 1, updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [rows[0].blast_id, userId]
  );
  await recountAggregates(userId, [rows[0].blast_id]);
}

/* ─────────────────── public API ─────────────────── */

/**
 * Register all tracking listeners for a socket.
 * Called from waSessionManager during startSession().
 */
function registerSocketListeners(socket, userId) {
  if (!socket || !userId) return;

  attachMessagesUpdate(socket, userId);
  attachMessagesUpsert(socket, userId);
}

// Expose flush for testing / manual trigger
async function flushAll() {
  for (const userId of flushQueues.keys()) {
    await flushQueue(userId);
  }
}

module.exports = {
  registerSocketListeners,
  flushAll,
};
