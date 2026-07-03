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

    await pool.query(
      `UPDATE blast_messages
       SET status = CASE
         WHEN status IN ('sent', 'delivered') THEN $1
         ELSE status
       END,
       ${col} = COALESCE(${col}, $2)
       WHERE wa_message_id = ANY($3::text[])
         AND wa_message_id IS NOT NULL`,
      [col.replace('_at', ''), ts, ids]
    );
  }
}

// Periodic flush for all non-empty queues
setInterval(() => {
  for (const userId of flushQueues.keys()) {
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

        const remoteJid = msg.key?.remoteJid;
        if (!remoteJid || !remoteJid.includes('@s.whatsapp.net')) continue;

        // Extract phone number (remove @s.whatsapp.net suffix)
        const phoneNumber = remoteJid.split('@')[0];

        const replyBody =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          null;

        // Find matching blast_message (recent, sent to this number)
        // Run async but don't block the event loop
        handlePotentialReply(userId, phoneNumber, replyBody).catch((err) => {
          console.error(`Reply detection error user=${userId} phone=${phoneNumber}:`, err);
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
    `SELECT bm.id, bm.status, b.blast_id
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

  // Upgrade status to replied (only forward — never downgrade)
  await pool.query(
    `UPDATE blast_messages
     SET status = 'replied', replied_at = NOW(), reply_body = COALESCE($1, reply_body)
     WHERE id = $2 AND replied_at IS NULL`,
    [replyBody, bm.id]
  );

  // Update aggregate counter on blast
  await pool.query(
    `UPDATE blasts SET replied_count = replied_count + 1, updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [rows[0].blast_id, userId]
  );
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
