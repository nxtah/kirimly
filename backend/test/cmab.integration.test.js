/**
 * Integrasi CMAB terhadap Postgres asli (DB test terpisah) — mirip pola
 * segmentation.integration.test.js: socket WhatsApp dipalsukan, blast dari
 * pipeline existing dipakai apa adanya untuk memicu status 'completed',
 * lalu reward dihitung lewat pemanggilan langsung ke processDueRewards()
 * (bukan menunggu setInterval nyata).
 *
 * Run: npm test
 */
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'kirimly_test';
process.env.BLAST_DELAY_MIN_MS = '10';
process.env.BLAST_DELAY_MAX_MS = '20';
process.env.BLAST_WAVE_DELAY_MIN_MS = '30';
process.env.BLAST_WAVE_DELAY_MAX_MS = '50';
process.env.CMAB_REWARD_DELAY_HOURS = '2';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const pool = require('../src/config/database');
const app = require('../src/app');
const waSessionManager = require('../src/services/waSessionManager');
const { registerSocketListeners } = require('../src/services/messageTrackingService');
const cmabService = require('../src/cmab/service');
const { hashPassword } = require('../src/utils/password');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = Date.now().toString(36);
const A = { username: `cmab_a_${suffix}`, password: 'passwordA1' };
const B = { username: `cmab_b_${suffix}`, password: 'passwordB1' };

let server, base;
let tokenA, tokenB, idA, idB;

async function call(method, urlPath, { token, body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(query) : '';
  const res = await fetch(`${base}${urlPath}${qs}`, {
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

async function createUser(u) {
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
    [u.username, await hashPassword(u.password)]
  );
  const login = await call('POST', '/api/auth/login', { body: u });
  assert.equal(login.status, 200);
  return { id: rows[0].id, token: login.data.token };
}

function installFakeSession(uid, sendMessageImpl) {
  const ev = new EventEmitter();
  const socket = { ev, sendMessage: sendMessageImpl, end() {} };
  registerSocketListeners(socket, uid); // wajib, agar delivered/read/reply benar-benar tercatat
  waSessionManager.sessions.set(uid, { socket, status: 'connected', qrRaw: null, qrDataUri: null });
  return socket;
}

async function createTemplate(token, name) {
  const r = await call('POST', '/api/templates', { token, body: { name, body: `Halo {{nama}}, ini ${name}` } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.template.id;
}

async function createContacts(token, n, prefix) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = await call('POST', '/api/contacts', { token, body: { name: `${prefix}${i}`, phone_number: `0811${prefix.length}${String(1000 + i).padStart(6, '0')}` } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    ids.push(r.data.contact.id);
  }
  return ids;
}

/** Kirim blast dan tunggu sampai statusnya 'completed', lalu backdate completed_at. */
async function sendBlastAndBackdate(token, templateId, contactIds, cmabDecisionId, hoursAgo = 3) {
  const r = await call('POST', '/api/blasts', {
    token,
    body: { template_id: templateId, waves: [contactIds], delay_per_contact_ms: 10, delay_per_wave_ms: 20, cmab_decision_id: cmabDecisionId },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const blastId = r.data.blast_id;
  await waitFor(async () => (await pool.query('SELECT status FROM blasts WHERE id=$1', [blastId])).rows[0].status === 'completed');
  await pool.query(`UPDATE blasts SET completed_at = NOW() - ($1 || ' hours')::interval WHERE id=$2`, [hoursAgo, blastId]);
  return blastId;
}

before(async () => {
  const setup = spawnSync(process.execPath, [path.join(__dirname, '../scripts/setup-db.js')], { encoding: 'utf-8' });
  assert.equal(setup.status, 0, 'test DB setup failed: ' + setup.stdout + setup.stderr);

  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  ({ id: idA, token: tokenA } = await createUser(A));
  ({ id: idB, token: tokenB } = await createUser(B));
});

after(async () => {
  waSessionManager.sessions.clear();
  await pool.query('DELETE FROM users WHERE username = ANY($1)', [[A.username, B.username]]);
  await pool.end();
  server.closeAllConnections();
  server.close();
});

/* ───────────────────────── auth & dasar ───────────────────────── */

test('endpoint CMAB butuh JWT', async () => {
  assert.equal((await call('POST', '/api/cmab/recommend')).status, 401);
  assert.equal((await call('GET', '/api/cmab/performance')).status, 401);
  assert.equal((await call('GET', '/api/cmab/decisions/latest')).status, 401);
});

test('recommend tanpa template ditolak dengan pesan jelas', async () => {
  const r = await call('POST', '/api/cmab/recommend', { token: tokenB });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /template/i);
});

let templateA1, templateA2;

test('recommend: audience default "general" tanpa data segmentasi, model dibuat lazy untuk semua template', async () => {
  templateA1 = await createTemplate(tokenA, 'Promo Kilat');
  templateA2 = await createTemplate(tokenA, 'Info Reguler');

  const r = await call('POST', '/api/cmab/recommend', { token: tokenA, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.context.audience_label, 'general');
  assert.ok([templateA1, templateA2].includes(r.data.recommended_template_id));
  assert.equal(r.data.scores.length, 2);

  const { rows } = await pool.query('SELECT template_id FROM cmab_models WHERE user_id=$1 ORDER BY template_id', [idA]);
  assert.deepEqual(rows.map((x) => x.template_id), [templateA1, templateA2].sort((a, b) => a - b));

  const { rows: dec } = await pool.query('SELECT * FROM cmab_decisions WHERE id=$1', [r.data.decision_id]);
  assert.equal(dec[0].user_id, idA);
  assert.equal(dec[0].blast_id, null, 'belum di-link ke blast manapun');
});

/* ───────────────────────── link ke blast & reward ───────────────────────── */

test('blast dari rekomendasi: link decision, reward belum dihitung sebelum jatuh tempo', async () => {
  const contacts = await createContacts(tokenA, 5, 'k');
  installFakeSession(idA, async (jid) => ({ key: { id: `WA-${suffix}-${jid}` } })); // semua sukses

  const rec = await call('POST', '/api/cmab/recommend', { token: tokenA });
  const blastId = await sendBlastAndBackdate(tokenA, rec.data.recommended_template_id, contacts, rec.data.decision_id, /* backdate */ 0);

  const { rows: dec } = await pool.query('SELECT * FROM cmab_decisions WHERE id=$1', [rec.data.decision_id]);
  assert.equal(dec[0].blast_id, blastId);
  assert.equal(dec[0].selected_template_id, rec.data.recommended_template_id);
  assert.ok(dec[0].linked_at);
  assert.equal(dec[0].reward, null, 'belum jatuh tempo (belum di-backdate)');

  await cmabService.processDueRewards();
  const { rows: still } = await pool.query('SELECT reward FROM cmab_decisions WHERE id=$1', [rec.data.decision_id]);
  assert.equal(still[0].reward, null, 'completed_at masih baru (0 jam lalu) -> belum diproses');
});

test('reward dihitung setelah delay terlewati, model ter-update, dan konsisten dengan formula', async () => {
  const contacts = await createContacts(tokenA, 5, 'r');
  installFakeSession(idA, async (jid) => ({ key: { id: `WA-${suffix}-${jid}` } }));

  const rec = await call('POST', '/api/cmab/recommend', { token: tokenA });
  const blastId = await sendBlastAndBackdate(tokenA, rec.data.recommended_template_id, contacts, rec.data.decision_id, 3);

  const before = (await pool.query(
    'SELECT observation_count, cumulative_reward FROM cmab_models WHERE user_id=$1 AND template_id=$2',
    [idA, rec.data.recommended_template_id]
  )).rows[0];

  await cmabService.processDueRewards();

  const { rows: dec } = await pool.query('SELECT reward, reward_computed_at FROM cmab_decisions WHERE id=$1', [rec.data.decision_id]);
  assert.ok(dec[0].reward_computed_at);
  // semua terkirim (delivered belum tentu true tanpa event messages.update, tapi sent_count=5, delivered/read/replied=0)
  // reward = 0.2*(delivered/5) + ... ; tanpa event delivered eksplisit, delivered_count tetap 0 -> reward 0
  assert.equal(Number(dec[0].reward), 0, 'tanpa event delivered/read/reply, reward = 0 (hanya sent)');

  const after = (await pool.query(
    'SELECT observation_count, cumulative_reward FROM cmab_models WHERE user_id=$1 AND template_id=$2',
    [idA, rec.data.recommended_template_id]
  )).rows[0];
  assert.equal(after.observation_count, before.observation_count + 1);
  assert.equal(Number(after.cumulative_reward), Number(before.cumulative_reward)); // +0

  // idempoten: dipanggil lagi tidak mengubah apapun (reward_computed_at sudah terisi)
  await cmabService.processDueRewards();
  const { rows: dec2 } = await pool.query('SELECT observation_count FROM cmab_models WHERE user_id=$1 AND template_id=$2', [idA, rec.data.recommended_template_id]);
  const { rows: modelAfterAgain } = await pool.query('SELECT observation_count FROM cmab_models WHERE user_id=$1 AND template_id=$2', [idA, rec.data.recommended_template_id]);
  assert.equal(modelAfterAgain[0].observation_count, after.observation_count, 'processDueRewards kedua tidak memproses ulang decision yang sudah dihitung');
});

test('reward penuh (delivered+read+replied) sesuai formula, dan model belajar (arm lebih baik makin disukai)', async () => {
  const contactsGood = await createContacts(tokenA, 2, 'good');
  const socket = installFakeSession(idA, async (jid) => {
    const id = `WAGOOD-${suffix}-${jid.split('@')[0]}`;
    return { key: { id } };
  });

  const rec = await call('POST', '/api/cmab/recommend', { token: tokenA });
  const targetTemplate = templateA2 === rec.data.recommended_template_id ? templateA1 : templateA2; // pakai arm yang BEDA dari rekomendasi, untuk membuktikan "selected", bukan "recommended", yang dipelajari
  const chosenTemplate = rec.data.recommended_template_id; // tetap pakai recommended agar sinyalnya jelas & sederhana

  const r = await call('POST', '/api/blasts', {
    token: tokenA,
    body: { template_id: chosenTemplate, waves: [contactsGood], delay_per_contact_ms: 10, delay_per_wave_ms: 20, cmab_decision_id: rec.data.decision_id },
  });
  const blastId = r.data.blast_id;
  await waitFor(async () => (await pool.query('SELECT status FROM blasts WHERE id=$1', [blastId])).rows[0].status === 'completed');

  // simulasikan delivered + read untuk kedua pesan, dan reply untuk satu nomor
  const { rows: msgs } = await pool.query('SELECT id, wa_message_id, phone_number FROM blast_messages WHERE blast_id=$1', [blastId]);
  socket.ev.emit('messages.update', msgs.map((m) => ({ key: { id: m.wa_message_id, fromMe: true }, update: { status: 3 } })));
  socket.ev.emit('messages.update', msgs.map((m) => ({ key: { id: m.wa_message_id, fromMe: true }, update: { status: 4 } })));
  // Tunggu delivered+read benar-benar ter-flush (messageTrackingService flush tiap 2 detik)
  // SEBELUM mengirim reply — reply hanya butuh status IN ('sent','delivered','read'), jadi bisa
  // "berhasil" lebih dulu daripada delivered/read selesai di-flush kalau tidak ditunggu eksplisit.
  await waitFor(async () => (await pool.query('SELECT delivered_count, read_count FROM blasts WHERE id=$1', [blastId])).rows[0].read_count === 2, { timeout: 8000 });

  socket.ev.emit('messages.upsert', {
    type: 'notify',
    messages: [{ key: { remoteJid: `${msgs[0].phone_number}@s.whatsapp.net`, fromMe: false }, message: { conversation: 'Oke!' } }],
  });
  await waitFor(async () => (await pool.query('SELECT replied_count FROM blasts WHERE id=$1', [blastId])).rows[0].replied_count === 1, { timeout: 8000 });

  await pool.query(`UPDATE blasts SET completed_at = NOW() - INTERVAL '3 hours' WHERE id=$1`, [blastId]);

  const before = (await pool.query('SELECT observation_count, cumulative_reward FROM cmab_models WHERE user_id=$1 AND template_id=$2', [idA, chosenTemplate])).rows[0];
  await cmabService.processDueRewards();

  const { rows: b } = await pool.query('SELECT total_contacts, delivered_count, read_count, replied_count FROM blasts WHERE id=$1', [blastId]);
  const expectedReward = 0.2 * (b[0].delivered_count / b[0].total_contacts) + 0.3 * (b[0].read_count / b[0].total_contacts) + 0.5 * (b[0].replied_count / b[0].total_contacts);
  assert.equal(b[0].delivered_count, 2);
  assert.equal(b[0].read_count, 2);
  assert.equal(b[0].replied_count, 1);
  // (0.2*1 + 0.3*1 + 0.5*0.5) = 0.75
  assert.ok(Math.abs(expectedReward - 0.75) < 1e-9);

  const { rows: dec } = await pool.query('SELECT reward FROM cmab_decisions WHERE blast_id=$1', [blastId]);
  assert.ok(Math.abs(Number(dec[0].reward) - expectedReward) < 1e-9);

  const after = (await pool.query('SELECT observation_count, cumulative_reward FROM cmab_models WHERE user_id=$1 AND template_id=$2', [idA, chosenTemplate])).rows[0];
  assert.equal(after.observation_count, before.observation_count + 1);
  assert.ok(Math.abs(Number(after.cumulative_reward) - Number(before.cumulative_reward) - expectedReward) < 1e-9);

  // recommend lagi dengan context yang sama-sama "general": template yang baru diberi reward tinggi mean_score-nya naik
  const rec2 = await call('POST', '/api/cmab/recommend', { token: tokenA });
  const scoreRow = rec2.data.scores.find((s) => s.template_id === chosenTemplate);
  assert.ok(scoreRow.mean_score > 0, `mean_score arm yang baru diberi reward tinggi harus > 0, got ${scoreRow.mean_score}`);
});

/* ───────────────────────── selected != recommended ───────────────────────── */

test('user mengganti template manual: model yang dipelajari adalah template yang BENAR-BENAR dipakai', async () => {
  const contacts = await createContacts(tokenA, 3, 'ovr');
  installFakeSession(idA, async () => ({ key: { id: `WAOVR-${suffix}-${Math.random()}` } }));

  const rec = await call('POST', '/api/cmab/recommend', { token: tokenA });
  const overrideTemplate = rec.data.recommended_template_id === templateA1 ? templateA2 : templateA1;

  const blastId = await sendBlastAndBackdate(tokenA, overrideTemplate, contacts, rec.data.decision_id, 3);

  const { rows: dec } = await pool.query('SELECT selected_template_id, recommended_template_id FROM cmab_decisions WHERE blast_id=$1', [blastId]);
  assert.equal(dec[0].selected_template_id, overrideTemplate);
  assert.notEqual(dec[0].selected_template_id, dec[0].recommended_template_id);

  const beforeOverride = (await pool.query('SELECT observation_count FROM cmab_models WHERE user_id=$1 AND template_id=$2', [idA, overrideTemplate])).rows[0];
  const beforeRecommended = (await pool.query('SELECT observation_count FROM cmab_models WHERE user_id=$1 AND template_id=$2', [idA, dec[0].recommended_template_id])).rows[0];

  await cmabService.processDueRewards();

  const afterOverride = (await pool.query('SELECT observation_count FROM cmab_models WHERE user_id=$1 AND template_id=$2', [idA, overrideTemplate])).rows[0];
  const afterRecommended = (await pool.query('SELECT observation_count FROM cmab_models WHERE user_id=$1 AND template_id=$2', [idA, dec[0].recommended_template_id])).rows[0];

  assert.equal(afterOverride.observation_count, beforeOverride.observation_count + 1, 'model template yang dipakai (override) yang belajar');
  assert.equal(afterRecommended.observation_count, beforeRecommended.observation_count, 'model template yang direkomendasikan tapi tidak dipakai TIDAK ikut belajar');
});

/* ───────────────────────── cmab_decision_id invalid / tanpa link ───────────────────────── */

test('blast tanpa cmab_decision_id tetap berjalan normal (opsional, tidak wajib)', async () => {
  const contacts = await createContacts(tokenA, 1, 'noopt');
  installFakeSession(idA, async () => ({ key: { id: `WANOOPT-${suffix}` } }));
  const r = await call('POST', '/api/blasts', {
    token: tokenA, body: { template_id: templateA1, waves: [contacts], delay_per_contact_ms: 10, delay_per_wave_ms: 20 },
  });
  assert.equal(r.status, 201);
});

test('cmab_decision_id milik user lain: link silent no-op, blast tetap sukses', async () => {
  const templateB = await createTemplate(tokenB, 'Template B');
  const contacts = await createContacts(tokenA, 1, 'badlink');
  installFakeSession(idA, async () => ({ key: { id: `WABADLINK-${suffix}` } }));

  const recB = await call('POST', '/api/cmab/recommend', { token: tokenB });

  const r = await call('POST', '/api/blasts', {
    token: tokenA,
    body: { template_id: templateA1, waves: [contacts], delay_per_contact_ms: 10, delay_per_wave_ms: 20, cmab_decision_id: recB.data.decision_id },
  });
  assert.equal(r.status, 201, 'blast tetap sukses walau decision_id bukan milik user ini');

  const { rows: dec } = await pool.query('SELECT blast_id FROM cmab_decisions WHERE id=$1', [recB.data.decision_id]);
  assert.equal(dec[0].blast_id, null, 'decision user B tidak ter-link oleh request user A');
});

/* ───────────────────────── audience dari segmentasi ───────────────────────── */

test('audience diturunkan dari cluster segmentasi (bukan cluster_no mentah)', async () => {
  const rows = [];
  for (let i = 0; i < 3; i++) {
    rows.push({ name: `SegTI${i}`, phone_number: `0899${String(2000 + i).padStart(7, '0')}`, program_studi: 'Teknik Informatika', asal_sekolah: 'SMA 1', jurusan_sekolah: 'IPA', domisili: 'Kota Bandung' });
  }
  for (let i = 0; i < 3; i++) {
    rows.push({ name: `SegMN${i}`, phone_number: `0899${String(3000 + i).padStart(7, '0')}`, program_studi: 'Manajemen', asal_sekolah: 'SMK 2', jurusan_sekolah: 'IPS', domisili: 'Kota Surabaya' });
  }
  const imp = await call('POST', '/api/segmentation/prospects/import', { token: tokenA, body: { rows } });
  assert.equal(imp.status, 201, JSON.stringify(imp.data));

  const run = await call('POST', '/api/segmentation/runs', { token: tokenA, body: { k: 2 } });
  assert.equal(run.status, 201, JSON.stringify(run.data));
  const segment = run.data.run.segments.find((s) => s.profile.dominant.program_studi === 'Teknik Informatika');
  assert.ok(segment, 'harus ada cluster yang dominan Teknik Informatika');
  const clusterNo = segment.cluster_no;

  const rec = await call('POST', '/api/cmab/recommend', { token: tokenA, body: { run_id: run.data.run.id, cluster_no: clusterNo } });
  assert.equal(rec.status, 200, JSON.stringify(rec.data));
  assert.equal(rec.data.context.audience_label, 'Teknik Informatika');

  // cluster_no/run_id milik user lain -> tidak boleh terbaca, jatuh ke "general"
  const recCrossUser = await call('POST', '/api/cmab/recommend', { token: tokenB, body: { run_id: run.data.run.id, cluster_no: clusterNo } });
  assert.equal(recCrossUser.data.context.audience_label, 'general');

  await call('DELETE', `/api/segmentation/prospects`, { token: tokenA, query: { delete_contacts: 'true' } });
});

/* ───────────────────────── performance & isolasi ───────────────────────── */

test('performance & latest decision terisi, dan terisolasi per user', async () => {
  const perfA = await call('GET', '/api/cmab/performance', { token: tokenA });
  assert.equal(perfA.status, 200);
  assert.ok(perfA.data.performance.length >= 2);
  assert.ok(perfA.data.performance.every((p) => typeof p.observation_count === 'number'));
  // NUMERIC columns (cumulative_reward, avg_reward) harus dikirim sebagai number JSON asli,
  // bukan string — kalau tidak, `.toFixed()` di frontend akan crash (regression guard).
  assert.ok(perfA.data.performance.every((p) => typeof p.cumulative_reward === 'number'));
  const withObservations = perfA.data.performance.find((p) => p.observation_count > 0);
  assert.ok(withObservations, 'setidaknya satu arm sudah punya reward dari test sebelumnya');
  assert.equal(typeof withObservations.avg_reward, 'number');
  assert.doesNotThrow(() => withObservations.avg_reward.toFixed(2));

  const latestA = await call('GET', '/api/cmab/decisions/latest', { token: tokenA });
  assert.equal(latestA.status, 200);
  assert.ok(latestA.data.decision.id);
  if (latestA.data.decision.reward != null) {
    assert.equal(typeof latestA.data.decision.reward, 'number');
    assert.doesNotThrow(() => latestA.data.decision.reward.toFixed(2));
  }

  const perfB = await call('GET', '/api/cmab/performance', { token: tokenB });
  assert.ok(perfB.data.performance.every((p) => p.template_name !== 'Promo Kilat' && p.template_name !== 'Info Reguler'), 'user B tidak melihat arm milik user A');
});
