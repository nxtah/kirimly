/**
 * blastService.js
 *
 * Async background processor for WhatsApp broadcast blasts.
 * Runs entirely in-process — no external queue.
 */

const pool = require('../config/database');
const waSessionManager = require('./waSessionManager');

// ── In-memory registry for active blast cancellations ──
const cancelledBlasts = new Set();
// Track active processing loops keyed by blastId
const activeProcessors = new Map();
// Debounce DB-down log spam
let _dbDownLogged = false;

// ── Read delays from env with defaults (read-only — never mutate) ──
const DELAY_MIN = parseInt(process.env.BLAST_DELAY_MIN_MS, 10) || 5000;
const DELAY_MAX = parseInt(process.env.BLAST_DELAY_MAX_MS, 10) || 10000;
const WAVE_DELAY_MIN = parseInt(process.env.BLAST_WAVE_DELAY_MIN_MS, 10) || 900000; // 15min
const WAVE_DELAY_MAX = parseInt(process.env.BLAST_WAVE_DELAY_MAX_MS, 10) || 1200000; // 20min
// Anti-banned utama = jumlah per wave + jeda antar wave; jumlah wave dibuat besar agar seluruh
// anggota sebuah cluster (ratusan kontak) bisa dijadwalkan tanpa terpotong.
const MAX_WAVES = parseInt(process.env.BLAST_MAX_WAVES, 10) || 100;
const MAX_PER_WAVE = parseInt(process.env.BLAST_MAX_PER_WAVE, 10) || 20;

function getContactDelay(fixedMs) {
  if (fixedMs) return fixedMs;
  return Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN;
}

/**
 * Sleep for `ms`, or until `abortPromise` resolves. Resolves 'delay' or 'abort'.
 * The timer is cleared on abort so cancelled blasts don't leave timers behind.
 */
function sleepOrAbort(ms, abortPromise) {
  let timer;
  const delay = new Promise((resolve) => { timer = setTimeout(() => resolve('delay'), ms); });
  return Promise.race([delay, abortPromise.then(() => 'abort')]).finally(() => clearTimeout(timer));
}

/* ───────────────────── helpers ───────────────────── */

/**
 * Replace {{variable}} placeholders with contact data.
 * Supported: {{nama}}, {{name}}, {{phone_number}}, {{notes}}
 */
function personalizeBody(body, contact) {
  const map = {
    nama: contact.name || '',
    name: contact.name || '',
    phone_number: contact.phone_number || '',
    notes: contact.notes || '',
  };

  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const lower = key.toLowerCase();
    return lower in map ? map[lower] : `{{${key}}}`;
  });
}

function assertConnected(userId) {
  if (!waSessionManager.isConnected(userId)) {
    const err = new Error('WhatsApp session is not connected');
    err.statusCode = 400;
    throw err;
  }
}

/* ───────────────────── orphan cleanup ───────────────────── */

/**
 * Called at server startup. Any blasts stuck in 'sending' status
 * are marked as cancelled — we can't safely resume them.
 */
async function markOrphanedBlasts() {
  // Their unsent messages can never be delivered now — fail them so counts stay consistent
  await pool.query(
    `UPDATE blast_messages
     SET status = 'failed', error_message = 'Server restarted'
     WHERE status = 'pending'
       AND blast_id IN (SELECT id FROM blasts WHERE status = 'sending')`
  );

  const { rowCount } = await pool.query(
    `UPDATE blasts SET status = 'cancelled', updated_at = NOW()
     WHERE status = 'sending'`
  );
  if (rowCount > 0) {
    console.log(`Marked ${rowCount} orphaned blast(s) as cancelled (server restart).`);
  }
}

/* ───────────────────── start / cancel ───────────────────── */

/**
 * Start a new broadcast blast with wave support.
 * @param {number} userId
 * @param {number} templateId
 * @param {number[][]} waves — array of arrays of contact.id values, e.g. [[1,2,3],[4,5,6]]
 * @param {string|null} scheduledAt — ISO timestamp, or null for instant
 * @returns {Promise<object>} the created blast row
 */
async function startBlast(userId, templateId, waves, scheduledAt = null, blastName = null, delayPerContactMs = null, delayPerWaveMs = null) {
  // 1. Validate WA socket is connected
  assertConnected(userId);

  // 2. Validate waves
  if (!Array.isArray(waves) || waves.length === 0 || waves.length > MAX_WAVES) {
    const err = new Error(`Waves must be 1-${MAX_WAVES} arrays of contact IDs`);
    err.statusCode = 400;
    throw err;
  }
  for (let w = 0; w < waves.length; w++) {
    if (!Array.isArray(waves[w]) || waves[w].length === 0 || waves[w].length > MAX_PER_WAVE) {
      const err = new Error(`Wave ${w + 1}: must have 1-${MAX_PER_WAVE} contacts`);
      err.statusCode = 400;
      throw err;
    }
  }

  const allContactIds = waves.flat().map(Number).filter(Number.isInteger);

  // 3. Fetch template + contacts (ownership enforced by SQL WHERE user_id; blocked contacts are skipped)
  const [templRes, contactsRes] = await Promise.all([
    pool.query('SELECT * FROM templates WHERE id = $1 AND user_id = $2', [templateId, userId]),
    pool.query(
      `SELECT id, name, phone_number, notes FROM contacts
       WHERE id = ANY($1::int[]) AND user_id = $2 AND is_blocked = FALSE`,
      [allContactIds, userId]
    ),
  ]);

  if (templRes.rows.length === 0) {
    const err = new Error('Template not found');
    err.statusCode = 404;
    throw err;
  }
  if (contactsRes.rows.length === 0) {
    const err = new Error('No valid contacts found');
    err.statusCode = 400;
    throw err;
  }

  const template = templRes.rows[0];

  // Build contact lookup
  const contactMap = {};
  for (const c of contactsRes.rows) contactMap[c.id] = c;

  // Drop unknown/blocked/duplicate contacts, then drop waves that became empty and renumber
  const seen = new Set();
  const cleanWaves = waves
    .map((wave) => wave.map(Number).filter((id) => {
      if (!contactMap[id] || seen.has(id)) return false;
      seen.add(id);
      return true;
    }))
    .filter((wave) => wave.length > 0);

  const totalContacts = seen.size;
  const numWaves = cleanWaves.length;
  const isScheduled = !!scheduledAt;
  const blastStatus = isScheduled ? 'scheduled' : 'sending';

  // 4. Create blast record (with delay columns for scheduled blast persistence)
  const { rows: blastRows } = await pool.query(
    `INSERT INTO blasts (user_id, template_id, name, total_contacts, status, sent_count, failed_count, scheduled_at, delay_per_contact_ms, delay_per_wave_ms)
     VALUES ($1, $2, $3, $4, $5, 0, 0, $6, $7, $8)
     RETURNING *`,
    [userId, templateId, blastName || template.name, totalContacts, blastStatus, scheduledAt, delayPerContactMs, delayPerWaveMs]
  );
  const blast = blastRows[0];

  // 5. Create blast_messages with wave_number
  let insertIdx = 0;
  const values = [];
  const flatParams = [blast.id];
  for (let w = 0; w < cleanWaves.length; w++) {
    for (const cId of cleanWaves[w]) {
      const c = contactMap[cId];
      const body = personalizeBody(template.body, c);
      const base = insertIdx * 4;
      values.push(`($1, $${base + 2}, $${base + 3}, $${base + 4}, 'pending', NOW(), $${base + 5})`);
      flatParams.push(c.id, c.phone_number, body, w + 1);
      insertIdx++;
    }
  }

  if (values.length > 0) {
    await pool.query(
      `INSERT INTO blast_messages (blast_id, contact_id, phone_number, message_body, status, created_at, wave_number)
       VALUES ${values.join(', ')}`,
      flatParams
    );
  }

  // 6. Kick off async processor (only for instant, not scheduled)
  if (!isScheduled) {
    processBlastWaves(blast.id, userId, numWaves, delayPerContactMs, delayPerWaveMs).catch((err) => {
      console.error(`Blast #${blast.id} processor error:`, err);
    });
  }

  // 7. Return blast record immediately
  return blast;
}

/**
 * Cancel a running blast.
 */
async function cancelBlast(blastId, userId) {
  const { rows } = await pool.query(
    'SELECT id, status FROM blasts WHERE id = $1 AND user_id = $2',
    [blastId, userId]
  );

  if (rows.length === 0) {
    const err = new Error('Blast not found');
    err.statusCode = 404;
    throw err;
  }

  const blast = rows[0];

  if (blast.status === 'completed' || blast.status === 'cancelled') {
    const err = new Error(`Blast is already ${blast.status}`);
    err.statusCode = 400;
    throw err;
  }

  // Signal cancellation to the running processor (if any) and wake it from its sleep
  const abort = activeProcessors.get(blastId);
  if (abort) {
    cancelledBlasts.add(blastId);
    abort();
  }

  // Mark as cancelled in DB (only if still in a cancellable state — TOCTOU safe)
  const { rowCount } = await pool.query(
    `UPDATE blasts SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status IN ('sending', 'draft', 'scheduled')`,
    [blastId]
  );

  if (rowCount === 0) {
    // Blast status changed between the SELECT and UPDATE — already done
    return { cancelled: false, reason: `Blast already completed` };
  }

  // No processor running (e.g. still scheduled) → nobody else will clean up the pending messages
  if (!abort) await failRemaining(blastId, 'Cancelled by user');

  return { cancelled: true };
}

/* ───────────────────── async processor ───────────────────── */

function getWaveDelay(fixedMs) {
  if (fixedMs) return fixedMs;
  return Math.floor(Math.random() * (WAVE_DELAY_MAX - WAVE_DELAY_MIN + 1)) + WAVE_DELAY_MIN;
}

/**
 * Background worker: processes blast wave by wave.
 * Within a wave: random 5-10s delay between messages.
 * Between waves: random 15-20min delay.
 * Runs asynchronously — never awaited by the controller.
 */
async function processBlastWaves(blastId, userId, numWaves, contactDelayMs = null, waveDelayMs = null) {
  let cancelled = false;

  const abortPromise = new Promise((resolve) => {
    activeProcessors.set(blastId, resolve);
  });

  const socket = waSessionManager.getSocket(userId);
  if (!socket) {
    console.error(`Blast #${blastId}: no socket for user ${userId}`);
    await abortBlast(blastId, 'Socket unavailable');
    activeProcessors.delete(blastId);
    return;
  }

  let sentCount = 0;
  let failedCount = 0;

  try {
    // Process wave by wave
    for (let wave = 1; wave <= numWaves; wave++) {
      // Check cancellation
      if (cancelledBlasts.has(blastId)) {
        cancelled = true;
        await failRemaining(blastId, 'Cancelled by user');
        break;
      }

      // Wait for inter-wave delay (skip for first wave)
      if (wave > 1) {
        const waveDelay = getWaveDelay(waveDelayMs);
        const raceResult = await sleepOrAbort(waveDelay, abortPromise);
        if (raceResult === 'abort' || cancelledBlasts.has(blastId)) {
          cancelled = true;
          await failRemaining(blastId, 'Cancelled by user');
          break;
        }
      }

      // Fetch pending messages for this wave
      const { rows: messages } = await pool.query(
        `SELECT id, phone_number, message_body FROM blast_messages
         WHERE blast_id = $1 AND wave_number = $2 AND status = 'pending'
         ORDER BY id ASC`,
        [blastId, wave]
      );

      for (const msg of messages) {
        if (cancelledBlasts.has(blastId)) {
          cancelled = true;
          await failRemaining(blastId, 'Cancelled by user');
          break;
        }

        const delay = getContactDelay(contactDelayMs);
        const raceResult = await sleepOrAbort(delay, abortPromise);

        if (raceResult === 'abort' || cancelledBlasts.has(blastId)) {
          cancelled = true;
          await failRemaining(blastId, 'Cancelled by user');
          break;
        }

        // Final cancellation check before sending
        if (cancelledBlasts.has(blastId)) {
          cancelled = true;
          await failRemaining(blastId, 'Cancelled by user');
          break;
        }

        try {
          const jid = `${msg.phone_number}@s.whatsapp.net`;
          const sent = await socket.sendMessage(jid, { text: msg.message_body });
          const waMsgId = sent?.key?.id || null;

          await pool.query(
            `UPDATE blast_messages SET status = 'sent', sent_at = NOW(), wa_message_id = $1
             WHERE id = $2`,
            [waMsgId, msg.id]
          );
          sentCount++;

          await pool.query(
            `UPDATE blasts SET sent_count = $1, updated_at = NOW() WHERE id = $2`,
            [sentCount, blastId]
          );
          await pool.query(
            `UPDATE contacts SET last_sent_at = NOW()
             WHERE user_id = $1 AND phone_number = $2`,
            [userId, msg.phone_number]
          );
        } catch (sendErr) {
          await pool.query(
            `UPDATE blast_messages SET status = 'failed', error_message = $1, sent_at = NOW()
             WHERE id = $2`,
            [sendErr.message?.slice(0, 500) || 'Send error', msg.id]
          );
          failedCount++;
          await pool.query(
            `UPDATE blasts SET failed_count = $1, updated_at = NOW() WHERE id = $2`,
            [failedCount, blastId]
          );
        }
      }

      if (cancelled) break;
    }

    if (!cancelled) {
      await pool.query(
        `UPDATE blasts
         SET status = 'completed', sent_count = $1, failed_count = $2,
             completed_at = NOW(), sent_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [sentCount, failedCount, blastId]
      );
    }
  } catch (err) {
    console.error(`Blast #${blastId} processor error:`, err);
    await abortBlast(blastId, 'Internal error').catch(() => {});
  } finally {
    cancelledBlasts.delete(blastId);
    activeProcessors.delete(blastId);
  }
}

/**
 * Mark all pending messages in a blast as failed.
 */
async function failRemaining(blastId, reason) {
  await pool.query(
    `UPDATE blast_messages
     SET status = 'failed', error_message = $1
     WHERE blast_id = $2 AND status = 'pending'`,
    [reason, blastId]
  );
  await pool.query(
    `UPDATE blasts
     SET failed_count = (SELECT COUNT(*) FROM blast_messages WHERE blast_id = $1 AND status = 'failed'),
         updated_at = NOW()
     WHERE id = $1`,
    [blastId]
  );
}

/**
 * Stop a blast that cannot continue: fail what's left and don't leave it stuck in 'sending'.
 */
async function abortBlast(blastId, reason) {
  await failRemaining(blastId, reason);
  await pool.query(
    `UPDATE blasts SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status = 'sending'`,
    [blastId]
  );
}

/* ───────────────────── scheduler ───────────────────── */

/**
 * Poll for scheduled blasts whose time has come and start processing them.
 * Called on a setInterval from index.js.
 */
async function processScheduledBlasts() {
  try {
    const { rows: dueBlasts } = await pool.query(
      `SELECT id, user_id, delay_per_contact_ms, delay_per_wave_ms FROM blasts
       WHERE status = 'scheduled' AND scheduled_at <= NOW()
       LIMIT 10`
    );

    let started = 0;
    for (const b of dueBlasts) {
      // Count waves for this blast
      const { rows: waveRows } = await pool.query(
        `SELECT COALESCE(MAX(wave_number), 1)::int AS num_waves FROM blast_messages
         WHERE blast_id = $1`,
        [b.id]
      );

      // Session not connected right now → leave it scheduled and retry on the next tick
      if (!waSessionManager.isConnected(b.user_id)) continue;

      await pool.query(
        `UPDATE blasts SET status = 'sending', updated_at = NOW() WHERE id = $1`,
        [b.id]
      );

      started++;
      processBlastWaves(b.id, b.user_id, waveRows[0].num_waves, b.delay_per_contact_ms, b.delay_per_wave_ms).catch((err) => {
        console.error(`Scheduled blast #${b.id} error:`, err);
      });
    }

    if (started > 0) {
      console.log(`Scheduler: started ${started} scheduled blast(s)`);
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      if (!_dbDownLogged) { console.warn('Scheduler: DB not reachable — skipping'); _dbDownLogged = true; }
    } else {
      console.error('Scheduler error:', err);
    }
  }
}

/* ───────────────────── query helpers (used by controller) ───────────────────── */

async function getBlast(blastId, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM blasts WHERE id = $1 AND user_id = $2`,
    [blastId, userId]
  );
  return rows[0] || null;
}

async function getBlastsByUser(userId, filters = {}) {
  const { search, from, to } = filters;
  const conditions = ['user_id = $1'];
  const params = [userId];
  let idx = 2;

  if (search) {
    conditions.push(`name ILIKE $${idx++}`);
    params.push(`%${search}%`);
  }
  if (from) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`created_at <= $${idx++}`);
    params.push(to + 'T23:59:59Z');
  }

  const { rows } = await pool.query(
    `SELECT id, user_id, template_id, name, total_contacts,
            sent_count, delivered_count, read_count, replied_count,
            failed_count, status, scheduled_at, sent_at, completed_at,
            created_at, updated_at
     FROM blasts WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 50`,
    params
  );
  return rows;
}

async function getBlastMessages(blastId, userId) {
  // First verify ownership via blast
  const blast = await getBlast(blastId, userId);
  if (!blast) return null;

  const { rows } = await pool.query(
    `SELECT bm.id, bm.contact_id, bm.phone_number, bm.message_body,
            bm.status, bm.error_message,
            bm.wa_message_id, bm.reply_body, bm.wave_number,
            bm.sent_at, bm.delivered_at, bm.read_at, bm.replied_at,
            c.name AS contact_name
     FROM blast_messages bm
     LEFT JOIN contacts c ON c.id = bm.contact_id
     WHERE bm.blast_id = $1
     ORDER BY bm.wave_number ASC, bm.id ASC`,
    [blastId]
  );
  return { blast, messages: rows };
}

/**
 * Get logs across all blasts for a user, with filters.
 */
async function getLogs(userId, filters) {
  const { page = 1, limit = 50, blast_id, status, search, from, to } = filters;
  const maxLimit = Math.min(Math.max(limit, 1), 5000);
  const offset = (Math.max(page, 1) - 1) * maxLimit;

  const conditions = ['b.user_id = $1'];
  const params = [userId];
  let idx = 2;

  if (blast_id) {
    conditions.push(`bm.blast_id = $${idx++}`);
    params.push(blast_id);
  }
  if (status) {
    conditions.push(`bm.status = $${idx++}`);
    params.push(status);
  }
  if (search) {
    const s = `%${search}%`;
    conditions.push(`(c.name ILIKE $${idx} OR bm.phone_number ILIKE $${idx})`);
    params.push(s);
    idx++;
  }
  if (from) {
    conditions.push(`bm.created_at >= $${idx++}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`bm.created_at <= $${idx++}`);
    params.push(to + 'T23:59:59Z');
  }

  const where = conditions.join(' AND ');

  const [dataRes, countRes, summaryRes] = await Promise.all([
    pool.query(
      `SELECT bm.id, bm.blast_id, b.name AS blast_name, bm.contact_id,
              c.name AS contact_name, bm.phone_number, bm.message_body,
              bm.status, bm.error_message, bm.wa_message_id, bm.reply_body,
              bm.sent_at, bm.delivered_at, bm.read_at, bm.replied_at, bm.created_at
       FROM blast_messages bm
       JOIN blasts b ON b.id = bm.blast_id
       LEFT JOIN contacts c ON c.id = bm.contact_id
       WHERE ${where}
       ORDER BY bm.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, maxLimit, offset]
    ),
    pool.query(
      `SELECT COUNT(*) FROM blast_messages bm
       JOIN blasts b ON b.id = bm.blast_id
       LEFT JOIN contacts c ON c.id = bm.contact_id
       WHERE ${where}`,
      params
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE bm.status = 'sent')::int AS sent,
         COUNT(*) FILTER (WHERE bm.status = 'delivered')::int AS delivered,
         COUNT(*) FILTER (WHERE bm.status = 'read')::int AS read,
         COUNT(*) FILTER (WHERE bm.status = 'replied')::int AS replied,
         COUNT(*) FILTER (WHERE bm.status = 'failed')::int AS failed
       FROM blast_messages bm
       JOIN blasts b ON b.id = bm.blast_id
       WHERE ${where}`,
      params
    ),
  ]);

  const totalCount = parseInt(countRes.rows[0].count, 10);

  return {
    logs: dataRes.rows,
    pagination: {
      page: Math.max(page, 1),
      limit: maxLimit,
      total: totalCount,
      total_pages: Math.ceil(totalCount / maxLimit),
    },
    summary: summaryRes.rows[0],
  };
}


/**
 * Create a new blast retrying only failed messages from a previous blast.
 */
async function retryFailed(originalBlastId, userId) {
  assertConnected(userId);

  // 1. Get original blast
  const { rows: blastRows } = await pool.query(
    'SELECT * FROM blasts WHERE id = $1 AND user_id = $2',
    [originalBlastId, userId]
  );
  if (blastRows.length === 0) {
    const err = new Error('Blast not found');
    err.statusCode = 404;
    throw err;
  }
  const original = blastRows[0];

  // 2. Get failed messages
  const { rows: failedMessages } = await pool.query(
    `SELECT bm.contact_id, bm.phone_number, bm.message_body FROM blast_messages bm WHERE bm.blast_id = $1 AND bm.status = 'failed'`,
    [originalBlastId]
  );
  if (failedMessages.length === 0) {
    const err = new Error('No failed messages to retry');
    err.statusCode = 400;
    throw err;
  }

  // 3. Create new blast (inherit delay settings from original blast)
  const numWaves = 1; // retry as single wave
  const { rows: newBlastRows } = await pool.query(
    `INSERT INTO blasts (user_id, template_id, name, total_contacts, status, sent_count, failed_count, delay_per_contact_ms, delay_per_wave_ms) VALUES ($1, $2, $3, $4, 'sending', 0, 0, $5, $6) RETURNING *`,
    [userId, original.template_id, original.name + ' (Retry)', failedMessages.length, original.delay_per_contact_ms, original.delay_per_wave_ms]
  );
  const newBlast = newBlastRows[0];

  // 4. Create blast_messages for failed contacts
  let idx = 0;
  const values = [];
  const params = [newBlast.id];
  for (const m of failedMessages) {
    const base = idx * 4;
    values.push('($1, $' + (base + 2) + ', $' + (base + 3) + ', $' + (base + 4) + ", 'pending', NOW(), 1)");
    params.push(m.contact_id, m.phone_number, m.message_body);
    idx++;
  }

  await pool.query(
    "INSERT INTO blast_messages (blast_id, contact_id, phone_number, message_body, status, created_at, wave_number) VALUES " + values.join(', '),
    params
  );

  // 5. Process
  processBlastWaves(newBlast.id, userId, numWaves, newBlast.delay_per_contact_ms, newBlast.delay_per_wave_ms).catch(err => {
    console.error('Retry blast #' + newBlast.id + ' error:', err);
  });

  return newBlast;
}

module.exports = {
  startBlast,
  retryFailed,
  cancelBlast,
  markOrphanedBlasts,
  getBlast,
  getBlastsByUser,
  getBlastMessages,
  getLogs,
  getContactDelay,
  processScheduledBlasts,
};
