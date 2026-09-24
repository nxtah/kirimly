/**
 * waSessionManager.js
 *
 * Multi-tenant Baileys session manager.
 * Maintains one socket per user (role='user'), persists auth state
 * to /sessions/{userId}/, and syncs status to wa_sessions table.
 */

const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { registerSocketListeners } = require('./messageTrackingService');

const SESSIONS_DIR = path.resolve(__dirname, '../../sessions');

// ── In-memory registry: userId → { socket, status, qrRaw, qrDataUri } ──
const sessions = new Map();

// userId → consecutive failed reconnects (reset once a QR or a connection succeeds)
const reconnectAttempts = new Map();
const reconnectTimers = new Map(); // userId → pending reconnect timeout
const MAX_RECONNECTS = 5;
const STABLE_CONNECTION_MS = 10_000; // how long 'open' must last before we consider it a real recovery

// WhatsApp rejects clients that announce an outdated Web version (Baileys' bundled one goes stale),
// so fetch the current one and cache it.
let cachedVersion = null;
let cachedVersionAt = 0;
async function getWaVersion() {
  if (cachedVersion && Date.now() - cachedVersionAt < 60 * 60 * 1000) return cachedVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedVersion = version;
    cachedVersionAt = Date.now();
    return version;
  } catch (err) {
    console.warn('Could not fetch latest WhatsApp Web version, using Baileys default:', err.message);
    return cachedVersion || undefined;
  }
}

/* ─────────────────────── helpers ─────────────────────── */

function sessionDir(userId) {
  return path.join(SESSIONS_DIR, String(userId));
}

function saveQrToFile(userId, qrRaw) {
  const dir = sessionDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '_last_qr.txt'), qrRaw, 'utf-8');
}

function loadLastQr(userId) {
  try {
    return fs.readFileSync(path.join(sessionDir(userId), '_last_qr.txt'), 'utf-8');
  } catch {
    return null;
  }
}

/* ─────────────────── DB helpers ─────────────────── */

async function upsertSession(userId, data) {
  const cols = Object.keys(data).join(', ');
  const vals = Object.values(data);
  const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');

  await pool.query(
    `INSERT INTO wa_sessions (user_id, ${cols})
     VALUES ($1, ${placeholders})
     ON CONFLICT (user_id) DO UPDATE
       SET ${Object.keys(data).map((k, i) => `${k} = EXCLUDED.${k}`).join(', ')},
           updated_at = NOW()`,
    [userId, ...vals]
  );
}

async function getDbSession(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM wa_sessions WHERE user_id = $1',
    [userId]
  );
  return rows[0] || null;
}

/* ─────────────────── session lifecycle ─────────────────── */

/**
 * Start (or restart) a Baileys socket for a given user.
 * Returns { qrRaw, qrDataUri } if still pending, or null if already connected.
 */
// userId → in-flight start. Two sockets on the SAME credentials kick each other off WhatsApp
// (stream conflict, code 440), so concurrent starts (boot-time restore + the connect page,
// a reconnect timer + a manual start, ...) must share ONE start instead of racing.
const startsInFlight = new Map();

function startSession(userId) {
  const running = startsInFlight.get(userId);
  if (running) return running;

  const p = doStartSession(userId).finally(() => startsInFlight.delete(userId));
  startsInFlight.set(userId, p);
  return p;
}

async function doStartSession(userId) {
  // A manual (re)start supersedes any pending automatic reconnect
  clearTimeout(reconnectTimers.get(userId));
  reconnectTimers.delete(userId);

  await upsertSession(userId, {
    status: 'pending',
    qr_code: null,
    qr_expires_at: null,
    credentials_json: null,
    error_message: null,
  });

  const dir = sessionDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const version = await getWaVersion();

  // Kill any existing socket right before creating the new one (after the awaits above, so a
  // socket registered while we were waiting can't be orphaned and keep fighting the new one).
  const existing = sessions.get(userId);
  if (existing?.socket) {
    existing.socket.ev.removeAllListeners();
    existing.socket.end(undefined);
    sessions.delete(userId);
  }

  const socket = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: ["Chrome", "Linux", ""],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
  });

  // Create a promise that resolves when QR arrives or connection opens
  let qrResolve;
  const qrWait = new Promise((resolve) => { qrResolve = resolve; });
  const entry = { socket, status: 'pending', qrRaw: null, qrDataUri: null };
  sessions.set(userId, entry);

  // ── Register delivery/read/reply tracking listeners ──
  registerSocketListeners(socket, userId);

  // ── Connection update handler ──
  socket.ev.on('connection.update', async (update) => {
    try {
      // A stale socket (already replaced by a newer one) must not touch shared state: without
      // this, its late 'close' deleted the NEW socket's entry (server thought "not connected"
      // while the phone showed connected) and scheduled yet another reconnect.
      if (sessions.get(userId) !== entry) {
        socket.ev.removeAllListeners();
        return;
      }

      const { connection, lastDisconnect, qr } = update;

    // ── QR received ──
    if (qr) {
      reconnectAttempts.delete(userId);
      entry.qrRaw = qr;
      entry.status = 'pending';
      try {
        entry.qrDataUri = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      } catch {
        entry.qrDataUri = null;
      }
      saveQrToFile(userId, qr);

      await upsertSession(userId, {
        status: 'pending',
        qr_code: qr,
        qr_expires_at: new Date(Date.now() + 60_000).toISOString(),
        error_message: null,
      });

      qrResolve('qr');
      return;
    }

    // ── Connected ──
    if (connection === 'open') {
      // Don't clear the reconnect budget yet — WhatsApp can report 'open' for a moment
      // before immediately closing again (e.g. a stream conflict from a stale connection
      // that hasn't been cleaned up server-side yet). Only a connection that STAYS open
      // for a while counts as "actually recovered" (checked in the close handler below);
      // otherwise a flapping connection would keep resetting the counter and retry forever.
      entry.openedAt = Date.now();
      entry.status = 'connected';
      const phone = socket.user?.id
        ? socket.user.id.split(':')[0]
        : null;

      await upsertSession(userId, {
        status: 'connected',
        phone_number: phone,
        last_connected_at: new Date().toISOString(),
        qr_code: null,
        qr_expires_at: null,
        error_message: null,
      });

      qrResolve('connected');
      return;
    }

    // ── Disconnected / closed ──
    if (connection === 'close') {
      const boom = lastDisconnect?.error;
      const reason = boom?.output?.statusCode ?? DisconnectReason.loggedOut;
      const isLoggedOut = reason === DisconnectReason.loggedOut;
      const isExpired = reason === DisconnectReason.connectionExpired;

      // Remove from memory
      socket.ev.removeAllListeners();
      sessions.delete(userId);

      if (isLoggedOut) {
        // Credentials no longer valid — clean up
        await upsertSession(userId, {
          status: 'disconnected',
          qr_code: null,
          credentials_json: null,
          error_message: 'User logged out from WhatsApp',
        });
        // Remove auth files
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        qrResolve('close');
        return;
      }

      // Reconnect unless explicitly terminated — with backoff, and give up after MAX_RECONNECTS
      if (!isExpired && reason !== DisconnectReason.loggedOut) {
        // Only treat this as a "fresh" failure streak (reset budget) if the connection was
        // actually stable for a while before dropping — otherwise a rapid open/close loop
        // (e.g. a stream conflict) would reset the counter every time and never give up.
        const wasStable = entry.openedAt && Date.now() - entry.openedAt >= STABLE_CONNECTION_MS;
        if (wasStable) reconnectAttempts.delete(userId);

        const attempt = (reconnectAttempts.get(userId) || 0) + 1;
        reconnectAttempts.set(userId, attempt);
        console.warn(`Session ${userId} closed (code ${reason}), reconnect attempt ${attempt}/${MAX_RECONNECTS}`);

        if (attempt > MAX_RECONNECTS) {
          reconnectAttempts.delete(userId);
          await upsertSession(userId, {
            status: 'disconnected',
            error_message: `Connection failed (code ${reason}). Please reconnect.`,
          });
        } else {
          await upsertSession(userId, { status: 'pending', error_message: 'Reconnecting…' });
          reconnectTimers.set(userId, setTimeout(() => {
            reconnectTimers.delete(userId);
            startSession(userId).catch((e) => console.error(`Session ${userId} reconnect error:`, e));
          }, Math.min(2000 * 2 ** (attempt - 1), 30000)));
        }
      }
      // Resolve qrWait on close so it doesn't hang (caller checks status)
      qrResolve('close');
    }
  } catch (err) {
    console.error(`Session ${userId} connection.update error:`, err);
    qrResolve('error');
  }
  });

  // ── Persist credentials whenever they change ──
  socket.ev.on('creds.update', () => {
    saveCreds().catch((err) => console.error(`Session ${userId} saveCreds error:`, err));
  });

  // Wait for QR or connected (with 30s timeout safety net)
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 30_000));
  await Promise.race([qrWait, timeout]);

  if (entry.status === 'connected') return null;
  return { qrRaw: entry.qrRaw, qrDataUri: entry.qrDataUri };
}

/**
 * Restore all persisted sessions from disk.
 * Called once at server startup.
 */
async function restoreAllSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    return;
  }

  const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
  const userIds = entries
    .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
    .map((e) => Number(e.name));

  if (userIds.length === 0) return;

  // Filter out sessions for users that no longer exist
  const { rows: validUsers } = await pool.query(
    'SELECT id FROM users WHERE id = ANY($1::int[])',
    [userIds]
  );
  const validIds = new Set(validUsers.map((r) => r.id));

  const toClean = userIds.filter((uid) => !validIds.has(uid));
  for (const uid of toClean) {
    try {
      const dir = sessionDir(uid);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      await pool.query('DELETE FROM wa_sessions WHERE user_id = $1', [uid]);
    } catch {}
  }
  if (toClean.length > 0) {
    console.log(`  Cleaned ${toClean.length} orphaned session(s):`, toClean);
  }

  const toRestore = userIds.filter((uid) => validIds.has(uid));
  if (toRestore.length === 0) return;

  console.log(`Restoring ${toRestore.length} WhatsApp session(s)…`);

  const results = await Promise.allSettled(
    toRestore.map((uid) => startSession(uid))
  );

  let ok = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') ok++;
    else console.error(`  Session ${toRestore[i]} restore failed:`, r.reason?.message);
  });
  console.log(`  ${ok}/${toRestore.length} sessions restored.`);
}

/**
 * Get current session info for a user (from memory + DB).
 */
async function getSessionInfo(userId) {
  const mem = sessions.get(userId);
  const db = await getDbSession(userId);

  return {
    status: mem?.status || db?.status || 'disconnected',
    phone_number: db?.phone_number || null,
    last_connected_at: db?.last_connected_at || null,
    error_message: db?.error_message || null,
    qrRaw: mem?.qrRaw || null,
    qrDataUri: mem?.qrDataUri || null,
    credentials_on_disk: fs.existsSync(sessionDir(userId)),
  };
}

/**
 * Force-disconnect a user's WhatsApp session.
 * Used by admin panel and user self-logout.
 */
async function terminateSession(userId, reason = 'user_initiated') {
  clearTimeout(reconnectTimers.get(userId));
  reconnectTimers.delete(userId);
  reconnectAttempts.delete(userId);

  const mem = sessions.get(userId);
  if (mem?.socket) {
    mem.socket.ev.removeAllListeners();
    mem.socket.end(undefined);
    sessions.delete(userId);
  }

  try {
    const dir = sessionDir(userId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {}

  await upsertSession(userId, {
    status: 'disconnected',
    qr_code: null,
    qr_expires_at: null,
    credentials_json: null,
    error_message: reason === 'admin_forced' ? 'Disconnected by admin' : 'User logged out',
  });

  // Also delete _last_qr.txt remnant
  try { fs.rmSync(path.join(sessionDir(userId), '_last_qr.txt'), { force: true }); } catch {}
}

/**
 * Get the active socket for a user (or null).
 */
function getSocket(userId) {
  return sessions.get(userId)?.socket || null;
}

/**
 * Check if a user has an active connected socket.
 */
function isConnected(userId) {
  return sessions.get(userId)?.status === 'connected';
}

module.exports = {
  startSession,
  restoreAllSessions,
  getSessionInfo,
  terminateSession,
  getSocket,
  isConnected,
  sessions, // exposed for debugging / admin
};
