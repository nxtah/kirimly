/**
 * End-to-end backend test against a real Postgres (see `npm run dev:db`).
 * The WhatsApp socket is faked: real WA needs a phone to scan the QR.
 *
 * Run: npm test
 */
process.env.NODE_ENV = 'test';
// Separate database so tests never touch dev data (created on demand by scripts/setup-db.js)
process.env.DB_NAME = process.env.TEST_DB_NAME || 'kirimly_test';
process.env.BLAST_DELAY_MIN_MS = '20';
process.env.BLAST_DELAY_MAX_MS = '40';
process.env.BLAST_WAVE_DELAY_MIN_MS = '50';
process.env.BLAST_WAVE_DELAY_MAX_MS = '80';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const pool = require('../src/config/database');
const app = require('../src/app');
const waSessionManager = require('../src/services/waSessionManager');
const blastService = require('../src/services/blastService');
const { registerSocketListeners } = require('../src/services/messageTrackingService');
const { hashPassword } = require('../src/utils/password');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = Date.now().toString(36);
const ADMIN = { username: `t_admin_${suffix}`, password: 'adminpass1' };
const USER = { username: `t_user_${suffix}`, password: 'userpass1' };

let server, base;
let adminToken, userToken, userId, adminId;
let sentLog = [];
let fakeSocket;

async function call(method, path, { token, body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(query) : '';
  const res = await fetch(`${base}${path}${qs}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function waitFor(fn, { timeout = 15000, every = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  throw new Error('waitFor timed out');
}

function installFakeSession(uid) {
  const ev = new EventEmitter();
  let n = 0;
  fakeSocket = {
    ev,
    sendMessage: async (jid, content) => {
      sentLog.push({ jid, text: content.text });
      if (jid.startsWith('62800000000')) throw new Error('simulated send failure');
      return { key: { id: `WAID-${suffix}-${++n}`, remoteJid: jid, fromMe: true } };
    },
    end() {},
  };
  registerSocketListeners(fakeSocket, uid);
  waSessionManager.sessions.set(uid, { socket: fakeSocket, status: 'connected', qrRaw: null, qrDataUri: null });
}

before(async () => {
  const setup = spawnSync(process.execPath, [path.join(__dirname, '../scripts/setup-db.js')], { encoding: 'utf-8' });
  assert.equal(setup.status, 0, 'test DB setup failed: ' + setup.stdout + setup.stderr);

  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  const { rows: a } = await pool.query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id`,
    [ADMIN.username, await hashPassword(ADMIN.password)]
  );
  adminId = a[0].id;
});

after(async () => {
  waSessionManager.sessions.clear();
  await pool.query('DELETE FROM users WHERE username = ANY($1)', [[ADMIN.username, USER.username]]);
  await pool.end();
  server.closeAllConnections();
  server.close();
});

/* ───────────────────────── auth & admin ───────────────────────── */

test('health check', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'ok');
});

test('login: rejects bad credentials, accepts good ones', async () => {
  assert.equal((await call('POST', '/api/auth/login', { body: { username: ADMIN.username, password: 'nope' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: {} })).status, 400);

  const r = await call('POST', '/api/auth/login', { body: ADMIN });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  adminToken = r.data.token;

  const me = await call('GET', '/api/auth/me', { token: adminToken });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.username, ADMIN.username);
});

test('protected routes require a token; admin routes require admin role', async () => {
  assert.equal((await call('GET', '/api/contacts')).status, 401);
  assert.equal((await call('GET', '/api/admin/users', { token: 'garbage' })).status, 401);
});

test('admin: create user, user logs in, cannot reach admin routes', async () => {
  const c = await call('POST', '/api/admin/users', { token: adminToken, body: { username: USER.username, password: USER.password } });
  assert.equal(c.status, 201);
  userId = c.data.user.id;

  assert.equal((await call('POST', '/api/admin/users', { token: adminToken, body: { username: USER.username, password: USER.password } })).status, 409);

  const l = await call('POST', '/api/auth/login', { body: USER });
  assert.equal(l.status, 200);
  userToken = l.data.token;

  assert.equal((await call('GET', '/api/admin/users', { token: userToken })).status, 403);

  const list = await call('GET', '/api/admin/users', { token: adminToken });
  assert.ok(list.data.users.some((u) => u.id === userId));
});

test('disabling a user revokes their existing token immediately', async () => {
  const off = await call('PUT', `/api/admin/users/${userId}`, { token: adminToken, body: { is_active: false } });
  assert.equal(off.status, 200);
  assert.equal((await call('GET', '/api/contacts', { token: userToken })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: USER })).status, 403);

  await call('PUT', `/api/admin/users/${userId}`, { token: adminToken, body: { is_active: true } });
  assert.equal((await call('GET', '/api/contacts', { token: userToken })).status, 200);
});

/* ───────────────────────── contacts & templates ───────────────────────── */

let contactIds = [];
let blockedId;
let templateId;

test('contacts: create, import (normalize + dedupe), pagination cap', async () => {
  const mk = async (name, phone) => (await call('POST', '/api/contacts', { token: userToken, body: { name, phone_number: phone } }));

  const c1 = await mk('Budi', '0812-3456-7001');
  assert.equal(c1.status, 201);
  assert.equal(c1.data.contact.phone_number, '6281234567001');
  contactIds.push(c1.data.contact.id);

  assert.equal((await mk('X', '12')).status, 400);

  const imp = await call('POST', '/api/contacts/import', {
    token: userToken,
    body: { contacts: [
      { name: 'Siti', phone_number: '+6281234567002' },
      { name: 'Dewi', phone_number: '081234567003' },
      { name: 'Dup', phone_number: '081234567001' },
      { name: 'Fail', phone_number: '0800-0000-0001' }, // → 6280000000001 (simulated send failure)
      { name: '', phone_number: '081' },
    ] },
  });
  assert.equal(imp.status, 201);
  assert.equal(imp.data.summary.imported, 3);
  assert.equal(imp.data.summary.duplicates, 1);
  assert.equal(imp.data.summary.invalid, 1);

  const list = await call('GET', '/api/contacts', { token: userToken, query: { limit: 500 } });
  assert.equal(list.data.pagination.limit, 500, 'limit=500 must be honored (new-blast page asks for 500)');
  assert.equal(list.data.contacts.length, 4);
  contactIds = list.data.contacts.map((c) => c.id);
  assert.ok(contactIds.length === 4);

  // one blocked contact for the blast filter test
  const b = await mk('Blocked', '081234567099');
  blockedId = b.data.contact.id;
  await pool.query('UPDATE contacts SET is_blocked = TRUE WHERE id = $1', [blockedId]);
});

test('contacts: isolated per user', async () => {
  const r = await call('GET', '/api/contacts', { token: adminToken });
  assert.equal(r.data.contacts.length, 0, "another account must not see the user's contacts");
  assert.equal((await call('PUT', `/api/contacts/${contactIds[0]}`, { token: adminToken, body: { name: 'hack' } })).status, 404);
});

test('templates: create extracts variables, update, list', async () => {
  const t = await call('POST', '/api/templates', { token: userToken, body: { name: 'Promo', body: 'Halo {{nama}}, promo untuk {{phone_number}}!', category: 'promo' } });
  assert.equal(t.status, 201);
  assert.deepEqual(t.data.template.variables, ['nama', 'phone_number']);
  templateId = t.data.template.id;

  const u = await call('PUT', `/api/templates/${templateId}`, { token: userToken, body: { name: 'Promo', body: 'Hai {{nama}}!', category: 'promo' } });
  assert.equal(u.status, 200);
  assert.equal(u.data.template.body, 'Hai {{nama}}!');
  assert.equal((await call('GET', '/api/templates', { token: userToken })).data.templates.length, 1);
});

/* ───────────────────────── blast ───────────────────────── */

test('blast: refused when WhatsApp is not connected (no dev bypass)', async () => {
  const r = await call('POST', '/api/blasts', { token: userToken, body: { template_id: templateId, waves: [[contactIds[0]]] } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /not connected/i);
});

let blastId;

test('blast: sends waves, skips blocked/duplicate/unknown contacts, personalizes, records failures', async () => {
  installFakeSession(userId);
  sentLog = [];

  const [budi, siti, dewi, fail] = ['6281234567001', '6281234567002', '6281234567003', '6280000000001'];
  const idOf = async (phone) => (await pool.query('SELECT id FROM contacts WHERE user_id=$1 AND phone_number=$2', [userId, phone])).rows[0].id;
  const ids = { budi: await idOf(budi), siti: await idOf(siti), dewi: await idOf(dewi), fail: await idOf(fail) };

  const r = await call('POST', '/api/blasts', {
    token: userToken,
    body: {
      name: 'Test Blast',
      template_id: templateId,
      // wave 1: budi + blocked + unknown id; wave 2: (only blocked → becomes empty); wave 3: siti, dewi, fail, duplicate budi
      waves: [[ids.budi, blockedId, 999999], [blockedId], [ids.siti, ids.dewi, ids.fail, ids.budi]],
      delay_per_contact_ms: 20,
      delay_per_wave_ms: 50,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  blastId = r.data.blast_id;
  assert.equal(r.data.total_contacts, 4, 'blocked, unknown and duplicate contacts must be dropped');

  await waitFor(async () => (await pool.query('SELECT status FROM blasts WHERE id=$1', [blastId])).rows[0].status === 'completed');

  const { rows: [b] } = await pool.query('SELECT * FROM blasts WHERE id=$1', [blastId]);
  assert.equal(b.sent_count, 3);
  assert.equal(b.failed_count, 1);

  const texts = sentLog.map((s) => s.text);
  assert.ok(texts.includes('Hai Budi!') && texts.includes('Hai Siti!'), 'template variables personalized');
  assert.ok(!sentLog.some((s) => s.jid.startsWith('6281234567099')), 'blocked contact never messaged');

  const { rows: msgs } = await pool.query('SELECT wave_number, status FROM blast_messages WHERE blast_id=$1 ORDER BY id', [blastId]);
  assert.deepEqual([...new Set(msgs.map((m) => m.wave_number))], [1, 2], 'empty wave removed, waves renumbered consecutively');
  assert.equal(msgs.filter((m) => m.status === 'failed').length, 1);

  const { rows: [c] } = await pool.query('SELECT last_sent_at FROM contacts WHERE id=$1', [ids.budi]);
  assert.ok(c.last_sent_at, 'contacts.last_sent_at updated');
});

test('blast: retry re-sends only failed messages', async () => {
  // make the failing number succeed on retry
  const origSend = fakeSocket.sendMessage;
  fakeSocket.sendMessage = async (jid, content) => ({ key: { id: `RETRY-${suffix}`, remoteJid: jid, fromMe: true } });

  const r = await call('POST', `/api/blasts/${blastId}/retry`, { token: userToken });
  assert.equal(r.status, 201);
  assert.equal(r.data.total_contacts, 1);
  await waitFor(async () => (await pool.query('SELECT status FROM blasts WHERE id=$1', [r.data.blast_id])).rows[0].status === 'completed');
  const { rows: [nb] } = await pool.query('SELECT sent_count, failed_count FROM blasts WHERE id=$1', [r.data.blast_id]);
  assert.equal(nb.sent_count, 1);
  assert.equal(nb.failed_count, 0);

  fakeSocket.sendMessage = origSend;
});

test('tracking: delivered / read / replied update messages AND blast counters', async () => {
  const { rows: sent } = await pool.query(
    `SELECT id, wa_message_id, phone_number FROM blast_messages WHERE blast_id=$1 AND status='sent' ORDER BY id`, [blastId]
  );
  assert.equal(sent.length, 3);

  // #1 delivered, #2 read (no delivery receipt first), #3 untouched
  fakeSocket.ev.emit('messages.update', [{ key: { id: sent[0].wa_message_id, fromMe: true }, update: { status: 3 } }]);
  fakeSocket.ev.emit('messages.update', [{ key: { id: sent[1].wa_message_id, fromMe: true }, update: { status: 4 } }]);

  await waitFor(async () => (await pool.query('SELECT delivered_count, read_count FROM blasts WHERE id=$1', [blastId])).rows[0].delivered_count === 2, { timeout: 8000 });
  const { rows: [b] } = await pool.query('SELECT delivered_count, read_count FROM blasts WHERE id=$1', [blastId]);
  assert.equal(b.delivered_count, 2, 'read implies delivered');
  assert.equal(b.read_count, 1);

  // reply from contact #1
  fakeSocket.ev.emit('messages.upsert', {
    type: 'notify',
    messages: [{ key: { remoteJid: `${sent[0].phone_number}@s.whatsapp.net`, fromMe: false }, message: { conversation: 'Mau dong!' } }],
  });
  await waitFor(async () => (await pool.query('SELECT replied_count FROM blasts WHERE id=$1', [blastId])).rows[0].replied_count === 1, { timeout: 5000 });
  const { rows: [m] } = await pool.query('SELECT status, reply_body FROM blast_messages WHERE id=$1', [sent[0].id]);
  assert.equal(m.status, 'replied');
  assert.equal(m.reply_body, 'Mau dong!');
});

test('tracking: reply backfills delivered/read even without a read receipt (recipient may have Read Receipts off)', async () => {
  // sent[0] (contact #1) was only 'delivered' above, never got a read receipt (status 4) —
  // but it DID reply, which proves it was received and read regardless.
  const { rows: [before] } = await pool.query(
    `SELECT status, delivered_at, read_at, replied_at FROM blast_messages
     WHERE blast_id=$1 ORDER BY id LIMIT 1`, [blastId]
  );
  assert.equal(before.status, 'replied');
  assert.ok(before.delivered_at, 'delivered_at backfilled by the reply');
  assert.ok(before.read_at, 'read_at backfilled by the reply, even with no read receipt ever received');
  assert.ok(before.replied_at);

  // Aggregate read_count on the blast must reflect this backfill (recounted, not just the row)
  const { rows: [b] } = await pool.query('SELECT read_count, delivered_count FROM blasts WHERE id=$1', [blastId]);
  assert.equal(b.read_count, 2, 'contact #1 (backfilled) + contact #2 (explicit read receipt) = 2');
  assert.equal(b.delivered_count, 2);
});

test('blast detail / messages / list / logs endpoints', async () => {
  const d = await call('GET', `/api/blasts/${blastId}`, { token: userToken });
  assert.equal(d.status, 200);
  assert.equal(d.data.blast.name, 'Test Blast');

  const m = await call('GET', `/api/blasts/${blastId}/messages`, { token: userToken });
  assert.equal(m.data.messages.length, 4);

  assert.equal((await call('GET', `/api/blasts/${blastId}`, { token: adminToken })).status, 404, 'other tenants cannot read it');

  const list = await call('GET', '/api/blasts', { token: userToken, query: { search: 'Test' } });
  assert.ok(list.data.blasts.length >= 1);

  const logs = await call('GET', '/api/logs', { token: userToken, query: { limit: 5000 } });
  assert.equal(logs.status, 200);
  assert.equal(logs.data.pagination.limit, 5000, 'dashboard asks for 5000 log rows');
  assert.ok(logs.data.summary.total >= 4);
});

test('dashboard stats: delivery/read rates are non-zero after tracking', async () => {
  const r = await call('GET', '/api/dashboard/stats', { token: userToken, query: { days: 7 } });
  assert.equal(r.status, 200);
  assert.ok(r.data.stats.messages_sent >= 3);
  assert.ok(r.data.stats.delivery_rate > 0, 'delivery_rate must reflect delivered_count');
  assert.ok(r.data.stats.read_rate > 0);
  assert.ok(r.data.stats.messages_replied >= 1);
  assert.equal(r.data.stats.total_contacts, 5);
});

test('blast: cancel stops a running blast and fails pending messages', async () => {
  const r = await call('POST', '/api/blasts', {
    token: userToken,
    body: { template_id: templateId, waves: [contactIds.slice(0, 3)], delay_per_contact_ms: 60000 },
  });
  assert.equal(r.status, 201);
  await sleep(200);

  const c = await call('POST', `/api/blasts/${r.data.blast_id}/cancel`, { token: userToken });
  assert.equal(c.status, 200);
  assert.equal(c.data.cancelled, true);

  const { rows: [b] } = await pool.query('SELECT status, failed_count FROM blasts WHERE id=$1', [r.data.blast_id]);
  assert.equal(b.status, 'cancelled');
  await waitFor(async () => (await pool.query(`SELECT COUNT(*)::int AS n FROM blast_messages WHERE blast_id=$1 AND status='pending'`, [r.data.blast_id])).rows[0].n === 0);
  assert.equal((await call('POST', `/api/blasts/${r.data.blast_id}/cancel`, { token: userToken })).status, 400, 'already cancelled');
});

test('blast: scheduled blast waits, then runs when due and connected; cancel of a scheduled blast fails its messages', async () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const okIds = (await pool.query(
    `SELECT id FROM contacts WHERE user_id=$1 AND phone_number = ANY($2) ORDER BY id`,
    [userId, ['6281234567002', '6281234567003']]
  )).rows.map((x) => x.id);
  const r = await call('POST', '/api/blasts', {
    token: userToken,
    body: { template_id: templateId, waves: [[okIds[0]], [okIds[1]]], scheduled_at: future, delay_per_contact_ms: 20, delay_per_wave_ms: 50 },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'scheduled');
  const id = r.data.blast_id;

  await blastService.processScheduledBlasts();
  assert.equal((await pool.query('SELECT status FROM blasts WHERE id=$1', [id])).rows[0].status, 'scheduled', 'not due yet');

  await pool.query(`UPDATE blasts SET scheduled_at = NOW() - INTERVAL '1 minute' WHERE id=$1`, [id]);

  // not connected → stays scheduled
  const saved = waSessionManager.sessions.get(userId);
  waSessionManager.sessions.delete(userId);
  await blastService.processScheduledBlasts();
  assert.equal((await pool.query('SELECT status FROM blasts WHERE id=$1', [id])).rows[0].status, 'scheduled', 'waits for WA connection');

  waSessionManager.sessions.set(userId, saved);
  await blastService.processScheduledBlasts();
  await waitFor(async () => (await pool.query('SELECT status FROM blasts WHERE id=$1', [id])).rows[0].status === 'completed');
  const { rows: [b] } = await pool.query('SELECT sent_count FROM blasts WHERE id=$1', [id]);
  assert.equal(b.sent_count, 2, 'both waves sent');

  // cancel a scheduled one
  const r2 = await call('POST', '/api/blasts', { token: userToken, body: { template_id: templateId, waves: [[okIds[0]]], scheduled_at: future } });
  const c = await call('POST', `/api/blasts/${r2.data.blast_id}/cancel`, { token: userToken });
  assert.equal(c.data.cancelled, true);
  const { rows: [m] } = await pool.query(`SELECT status FROM blast_messages WHERE blast_id=$1`, [r2.data.blast_id]);
  assert.equal(m.status, 'failed');
});

test('startup cleanup: orphaned "sending" blasts are cancelled and their pending messages failed', async () => {
  const { rows: [b] } = await pool.query(
    `INSERT INTO blasts (user_id, template_id, name, total_contacts, status) VALUES ($1,$2,'orphan',1,'sending') RETURNING id`, [userId, templateId]
  );
  await pool.query(`INSERT INTO blast_messages (blast_id, phone_number, message_body, status) VALUES ($1,'6281111111111','x','pending')`, [b.id]);

  await blastService.markOrphanedBlasts();

  assert.equal((await pool.query('SELECT status FROM blasts WHERE id=$1', [b.id])).rows[0].status, 'cancelled');
  assert.equal((await pool.query('SELECT status FROM blast_messages WHERE blast_id=$1', [b.id])).rows[0].status, 'failed');
});

/* ───────────────────────── admin monitoring ───────────────────────── */

test('admin: stats, monitoring sessions, login logs, terminate session, delete user', async () => {
  const s = await call('GET', '/api/admin/stats', { token: adminToken });
  assert.equal(s.status, 200);
  assert.ok(s.data.messaging.total_blast_messages >= 4);

  const sess = await call('GET', '/api/admin/monitoring/sessions', { token: adminToken });
  assert.ok(sess.data.sessions.some((x) => x.user_id === userId && x.status === 'connected'));

  const logs = await call('GET', '/api/admin/monitoring/login-logs', { token: adminToken, query: { user_id: String(userId) } });
  assert.ok(logs.data.logs.length >= 1);

  const t = await call('POST', `/api/admin/monitoring/sessions/${userId}/terminate`, { token: adminToken });
  assert.equal(t.status, 200);
  assert.equal(waSessionManager.sessions.has(userId), false);

  assert.equal((await call('DELETE', `/api/admin/users/${adminId}`, { token: adminToken })).status, 400, 'cannot delete self');
  assert.equal((await call('DELETE', `/api/admin/users/${userId}`, { token: adminToken })).status, 200);
  assert.equal((await call('GET', '/api/contacts', { token: userToken })).status, 401, 'deleted user token is dead');
});

test('login rate limit kicks in after too many attempts', async () => {
  let last;
  for (let i = 0; i < 25; i++) {
    last = await call('POST', '/api/auth/login', { body: { username: 'nobody', password: 'x' } });
  }
  assert.equal(last.status, 429);
});
