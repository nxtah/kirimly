/**
 * waSessionManager.js
 *
 * Multi-tenant Baileys session manager.
 * Maintains one socket per user (role='user'), persists auth state
 * to /sessions/{userId}/, and syncs status to wa_sessions table.
 */

const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { registerSocketListeners } = require('./messageTrackingService');

const SESSIONS_DIR = path.resolve(__dirname, '../../sessions');

// ── In-memory registry: userId → { socket, status, qrRaw, qrDataUri } ──
const sessions = new Map();

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
async function startSession(userId) {
  // Kill existing socket if any
  const existing = sessions.get(userId);
  if (existing?.socket) {
    existing.socket.end(undefined);
    existing.socket.ev.removeAllListeners();
  }

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

  const socket = makeWASocket({
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
      const { connection, lastDisconnect, qr } = update;

    // ── QR received ──
    if (qr) {
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

      // Reconnect unless explicitly terminated
      if (!isExpired && reason !== DisconnectReason.loggedOut) {
        await upsertSession(userId, { status: 'pending', error_message: 'Reconnecting…' });
        // Small delay to avoid reconnect storms
        setTimeout(() => startSession(userId), 2000);
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

  console.log(`Restoring ${userIds.length} WhatsApp session(s)…`);

  const results = await Promise.allSettled(
    userIds.map((uid) => startSession(uid))
  );

  let ok = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') ok++;
    else console.error(`  Session ${userIds[i]} restore failed:`, r.reason?.message);
  });
  console.log(`  ${ok}/${userIds.length} sessions restored.`);
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
