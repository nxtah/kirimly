/**
 * Integrasi segmentasi terhadap Postgres asli (DB test terpisah) — termasuk blast dari cluster
 * memakai pipeline blast existing dengan socket WhatsApp palsu.
 *
 * Run: npm test
 */
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'kirimly_test';
process.env.BLAST_DELAY_MIN_MS = '10';
process.env.BLAST_DELAY_MAX_MS = '20';
process.env.BLAST_WAVE_DELAY_MIN_MS = '30';
process.env.BLAST_WAVE_DELAY_MAX_MS = '50';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const pool = require('../src/config/database');
const app = require('../src/app');
const waSessionManager = require('../src/services/waSessionManager');
const { hashPassword } = require('../src/utils/password');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = Date.now().toString(36);
const A = { username: `seg_a_${suffix}`, password: 'passwordA1' };
const B = { username: `seg_b_${suffix}`, password: 'passwordB1' };

let server, base;
let tokenA, tokenB, idA, idB;
let runId;

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

/* ── dataset: 3 kelompok × 30, penulisan sengaja bervariasi (harus tersatukan oleh cleaning) ── */
const GROUPS = [
  { prodi: ['Teknik Informatika', 'S1 Teknik Informatika', 'TI'], sekolah: ['SMA Negeri 1 Bandung', 'SMAN 1 Bandung', 'sma n 1 bandung'], jurusan: ['IPA', 'MIPA', 'ipa'], kota: ['Kota Bandung', 'Kota Bandung, Jawa Barat', 'kota bandung'] },
  { prodi: ['Manajemen', 'S1 Manajemen', 'manajemen'], sekolah: ['SMK Negeri 2 Surabaya', 'SMKN 2 Surabaya', 'smk n 2 surabaya'], jurusan: ['Akuntansi', 'AKL', 'akuntansi'], kota: ['Kota Surabaya', 'kota surabaya', 'Kota Surabaya, Jawa Timur'] },
  { prodi: ['Ilmu Hukum', 'S1 Ilmu Hukum', 'hukum'], sekolah: ['SMA Swasta Harapan Medan', 'sma swasta harapan medan', 'SMA  Swasta  Harapan  Medan'], jurusan: ['IPS', 'Ilmu Pengetahuan Sosial', 'ips'], kota: ['Kota Medan', 'kota medan', 'Kota Medan, Sumatera Utara'] },
];

function makeRows(perGroup = 30) {
  const rows = [];
  GROUPS.forEach((g, gi) => {
    for (let i = 0; i < perGroup; i++) {
      rows.push({
        name: `Calon ${gi}-${i}`,
        phone_number: `08${gi + 1}${String(1000000 + i).padStart(8, '0')}`, // 08 1/2/3 xxxxxxxx
        program_studi: g.prodi[i % 3],
        asal_sekolah: g.sekolah[i % 3],
        jurusan_sekolah: g.jurusan[i % 3],
        domisili: g.kota[i % 3],
      });
    }
  });
  return rows;
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

/* ───────────────────────── auth ───────────────────────── */

test('semua endpoint segmentasi butuh JWT', async () => {
  for (const [m, p] of [['GET', '/prospects'], ['GET', '/prospects/summary'], ['POST', '/prospects/import'],
    ['GET', '/suggest-k'], ['GET', '/runs'], ['POST', '/runs'], ['GET', '/runs/1'], ['GET', '/runs/1/segments/1/members']]) {
    assert.equal((await call(m, `/api/segmentation${p}`)).status, 401, `${m} ${p}`);
  }
});

/* ───────────────────────── import ───────────────────────── */

test('clustering ditolak dengan pesan jelas bila belum ada data', async () => {
  const s = await call('GET', '/api/segmentation/suggest-k', { token: tokenA });
  assert.equal(s.status, 400);
  const r = await call('POST', '/api/segmentation/runs', { token: tokenA, body: { k: 3 } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /lebih sedikit/);
});

test('import: validasi, cleaning, duplikat, sinkron ke contacts tanpa menimpa nama existing', async () => {
  // kontak yang sudah ada dengan nama buatan user
  const first = makeRows()[0];
  const phone = '62' + first.phone_number.slice(1);
  await pool.query(`INSERT INTO contacts (user_id, name, phone_number) VALUES ($1, 'Nama Custom User', $2)`, [idA, phone]);

  const rows = [
    ...makeRows(),
    { name: '', phone_number: '081234567000', program_studi: 'X' },                        // tanpa nama
    { name: 'Nomor Salah', phone_number: '12', program_studi: 'X' },                       // nomor invalid
    { ...makeRows()[1], name: 'Duplikat Nomor' },                                          // nomor sama dengan baris lain
    { name: 'Atribut Kosong', phone_number: '089900000001' },                              // atribut kosong → Tidak Diketahui
  ];

  // dikirim per batch seperti frontend (maks 500/batch)
  const r = await call('POST', '/api/segmentation/prospects/import', { token: tokenA, body: { rows } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.summary.imported, 91);          // 90 + 1 atribut kosong
  assert.equal(r.data.summary.invalid, 2);
  assert.equal(r.data.summary.duplicates, 1);
  assert.equal(r.data.summary.missing_attributes.program_studi, 1);
  assert.equal(r.data.errors.length, 2);

  // nilai sudah distandarisasi: 3 penulisan → 1 kategori
  const { rows: dist } = await pool.query(
    `SELECT asal_sekolah, COUNT(*)::int n FROM prospects WHERE user_id=$1 AND asal_sekolah <> 'Tidak Diketahui' GROUP BY 1 ORDER BY 1`, [idA]
  );
  assert.deepEqual(dist.map((d) => d.asal_sekolah), ['SMA Negeri 1 Bandung', 'SMA Swasta Harapan Medan', 'SMK Negeri 2 Surabaya']);
  assert.ok(dist.every((d) => d.n === 30));

  // contacts tersinkron; nama existing tidak ditimpa
  const { rows: c } = await pool.query(`SELECT COUNT(*)::int n FROM contacts WHERE user_id=$1`, [idA]);
  assert.equal(c[0].n, 91);
  const { rows: kept } = await pool.query(`SELECT name FROM contacts WHERE user_id=$1 AND phone_number=$2`, [idA, phone]);
  assert.equal(kept[0].name, 'Nama Custom User');

  // import ulang = update, bukan duplikat
  const again = await call('POST', '/api/segmentation/prospects/import', { token: tokenA, body: { rows: makeRows(2) } });
  assert.equal(again.data.summary.imported, 0);
  assert.equal(again.data.summary.updated, 6);
});

test('import: batas 500 baris & body tidak valid', async () => {
  const big = Array.from({ length: 501 }, (_, i) => ({ name: `x${i}`, phone_number: `0877000${i}` }));
  assert.equal((await call('POST', '/api/segmentation/prospects/import', { token: tokenA, body: { rows: big } })).status, 400);
  assert.equal((await call('POST', '/api/segmentation/prospects/import', { token: tokenA, body: { rows: [] } })).status, 400);
  assert.equal((await call('POST', '/api/segmentation/prospects/import', { token: tokenA, body: {} })).status, 400);
});

test('prospects: list, search, summary, delete, isolasi antar user', async () => {
  const list = await call('GET', '/api/segmentation/prospects', { token: tokenA, query: { limit: 10 } });
  assert.equal(list.data.pagination.total, 91);
  assert.equal(list.data.prospects.length, 10);

  const search = await call('GET', '/api/segmentation/prospects', { token: tokenA, query: { search: 'Medan' } });
  assert.equal(search.data.pagination.total, 30);

  const sum = await call('GET', '/api/segmentation/prospects/summary', { token: tokenA });
  assert.equal(sum.data.total, 91);
  assert.ok(sum.data.distribution.domisili.some((d) => d.value === 'Kota Bandung' && d.count === 30));

  // user B tidak melihat data A
  assert.equal((await call('GET', '/api/segmentation/prospects', { token: tokenB })).data.pagination.total, 0);

  // hapus 1 prospek (baris "Atribut Kosong") — user B tidak bisa
  const target = (await call('GET', '/api/segmentation/prospects', { token: tokenA, query: { search: 'Atribut Kosong' } })).data.prospects[0];
  assert.equal((await call('DELETE', `/api/segmentation/prospects/${target.id}`, { token: tokenB })).status, 404);
  assert.equal((await call('DELETE', `/api/segmentation/prospects/${target.id}`, { token: tokenA })).status, 200);
  assert.equal((await call('GET', '/api/segmentation/prospects/summary', { token: tokenA })).data.total, 90);
});

/* ───────────────────────── clustering ───────────────────────── */

test('suggest-k merekomendasikan K=3 untuk 3 kelompok yang jelas', async () => {
  const r = await call('GET', '/api/segmentation/suggest-k', { token: tokenA, query: { max: 6 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.n_samples, 90);
  assert.equal(r.data.recommended, 3);
  // data hanya punya 3 pola unik → K maksimum yang mungkin adalah 3
  assert.deepEqual(r.data.scores.map((s) => s.k), [2, 3]);
  assert.ok(r.data.scores.find((s) => s.k === 3).silhouette > 0.5);
});

test('run: validasi K', async () => {
  for (const k of [1, 11, 2.5, 'abc', undefined]) {
    assert.equal((await call('POST', '/api/segmentation/runs', { token: tokenA, body: { k } })).status, 400, `k=${k}`);
  }
  const tiny = await call('POST', '/api/segmentation/runs', { token: tokenB, body: { k: 3 } });
  assert.equal(tiny.status, 400);
});

test('run K=3: 3 cluster, jumlah anggota & karakteristik dominan benar, tersimpan di DB', async () => {
  const r = await call('POST', '/api/segmentation/runs', { token: tokenA, body: { k: 3, name: 'Uji 3 Cluster' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));

  const run = r.data.run;
  runId = run.id;
  assert.equal(run.name, 'Uji 3 Cluster');
  assert.equal(run.k, 3);
  assert.equal(run.n_samples, 90);
  assert.ok(run.silhouette > 0.5);
  assert.equal(run.segments.length, 3);
  assert.deepEqual(run.segments.map((s) => s.cluster_no), [1, 2, 3]);
  assert.equal(run.segments.reduce((s, x) => s + x.size, 0), 90);

  // tiap cluster = satu kelompok asli (30 orang) dengan karakteristik dominan 100%
  const dominants = run.segments.map((s) => s.profile.dominant.program_studi).sort();
  assert.deepEqual(dominants, ['Ilmu Hukum', 'Manajemen', 'Teknik Informatika']);
  for (const seg of run.segments) {
    assert.equal(seg.size, 30);
    assert.equal(seg.profile.attributes.program_studi[0].percent, 100);
    assert.equal(seg.profile.attributes.asal_sekolah[0].percent, 100);
  }
  const ti = run.segments.find((s) => s.profile.dominant.program_studi === 'Teknik Informatika');
  assert.equal(ti.profile.dominant.domisili, 'Kota Bandung');
  assert.equal(ti.profile.dominant.jurusan_sekolah, 'IPA');

  // params menegaskan hanya 4 atribut clustering yang dipakai (tanpa nama/nomor)
  const { rows } = await pool.query('SELECT params FROM cluster_runs WHERE id=$1', [runId]);
  assert.deepEqual(rows[0].params.attributes, ['program_studi', 'asal_sekolah', 'jurusan_sekolah', 'domisili']);
  assert.ok(rows[0].params.features.every((f) => rows[0].params.attributes.includes(f.attr)));
  const { rows: m } = await pool.query(
    `SELECT COUNT(*)::int n FROM cluster_members cm JOIN cluster_segments s ON s.id = cm.segment_id WHERE s.run_id=$1`, [runId]
  );
  assert.equal(m[0].n, 90);
});

test('run: deterministik (data sama → pembagian sama) & riwayat tersimpan', async () => {
  const r2 = await call('POST', '/api/segmentation/runs', { token: tokenA, body: { k: 3 } });
  assert.equal(r2.status, 201);
  const first = (await call('GET', `/api/segmentation/runs/${runId}`, { token: tokenA })).data.run;
  const second = r2.data.run;
  assert.deepEqual(first.segments.map((s) => s.profile.dominant), second.segments.map((s) => s.profile.dominant));
  assert.equal(first.silhouette, second.silhouette);

  const list = await call('GET', '/api/segmentation/runs', { token: tokenA });
  assert.ok(list.data.runs.length >= 2);
  await call('DELETE', `/api/segmentation/runs/${r2.data.run.id}`, { token: tokenA });
});

test('run: isolasi antar user', async () => {
  assert.equal((await call('GET', `/api/segmentation/runs/${runId}`, { token: tokenB })).status, 404);
  assert.equal((await call('GET', `/api/segmentation/runs/${runId}/segments/1/members`, { token: tokenB })).status, 404);
  assert.equal((await call('DELETE', `/api/segmentation/runs/${runId}`, { token: tokenB })).status, 404);
  assert.equal((await call('GET', '/api/segmentation/runs', { token: tokenB })).data.runs.length, 0);
});

/* ───────────────────────── anggota & blast dari cluster ───────────────────────── */

test('members: tanpa kontak blocked, yang belum pernah dikirimi didahulukan, limit & eligible', async () => {
  const run = (await call('GET', `/api/segmentation/runs/${runId}`, { token: tokenA })).data.run;
  const no = run.segments[0].cluster_no;

  const all = (await call('GET', `/api/segmentation/runs/${runId}/segments/${no}/members`, { token: tokenA })).data;
  assert.equal(all.size, 30);
  assert.equal(all.eligible, 30);
  assert.equal(all.members.length, 30);

  // blokir 1 anggota, tandai 5 lainnya sudah pernah dikirimi
  const ids = all.members.map((m) => m.contact_id);
  await pool.query(`UPDATE contacts SET is_blocked = TRUE WHERE id = $1`, [ids[0]]);
  await pool.query(`UPDATE contacts SET last_sent_at = NOW() - INTERVAL '1 hour' WHERE id = ANY($1)`, [ids.slice(1, 6)]);

  const r = (await call('GET', `/api/segmentation/runs/${runId}/segments/${no}/members`, { token: tokenA })).data;
  assert.equal(r.eligible, 29);
  assert.ok(!r.members.some((m) => m.contact_id === ids[0]), 'blocked tidak boleh ikut');
  assert.deepEqual(r.members.slice(-5).map((m) => m.contact_id).sort(), ids.slice(1, 6).sort(), 'yang sudah pernah dikirimi di urutan terakhir');
  assert.ok(r.members.slice(0, 24).every((m) => m.last_sent_at === null));

  const limited = (await call('GET', `/api/segmentation/runs/${runId}/segments/${no}/members`, { token: tokenA, query: { limit: 10 } })).data;
  assert.equal(limited.members.length, 10);
  assert.equal(limited.eligible, 29);

  assert.equal((await call('GET', `/api/segmentation/runs/${runId}/segments/99/members`, { token: tokenA })).status, 404);
});

test('blast dari cluster: memakai pipeline blast existing (wave ≤ 20, maks 60), last_sent_at ter-update', async () => {
  const run = (await call('GET', `/api/segmentation/runs/${runId}`, { token: tokenA })).data.run;
  const no = run.segments[1].cluster_no;

  // sesi WA palsu
  const sent = [];
  const socket = {
    ev: new EventEmitter(),
    sendMessage: async (jid, content) => { sent.push({ jid, text: content.text }); return { key: { id: `WA-${sent.length}-${suffix}` } }; },
    end() {},
  };
  waSessionManager.sessions.set(idA, { socket, status: 'connected', qrRaw: null, qrDataUri: null });

  const tpl = await call('POST', '/api/templates', { token: tokenA, body: { name: 'Info PMB', body: 'Halo {{nama}}, pendaftaran dibuka!' } });
  assert.equal(tpl.status, 201);

  // persis seperti yang dilakukan halaman "New Broadcast": ambil anggota, bagi per 20 per wave
  const { members, eligible } = (await call('GET', `/api/segmentation/runs/${runId}/segments/${no}/members`, { token: tokenA, query: { limit: 60 } })).data;
  assert.equal(members.length, 30);
  assert.equal(eligible, 30);
  const ids = members.map((m) => m.contact_id);
  const waves = [ids.slice(0, 20), ids.slice(20, 40)].filter((w) => w.length);

  const b = await call('POST', '/api/blasts', {
    token: tokenA,
    body: { name: `Blast cluster ${no}`, template_id: tpl.data.template.id, waves, delay_per_contact_ms: 10, delay_per_wave_ms: 30 },
  });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  assert.equal(b.data.total_contacts, 30);

  await waitFor(async () => (await pool.query('SELECT status FROM blasts WHERE id=$1', [b.data.blast_id])).rows[0].status === 'completed');
  const { rows: [row] } = await pool.query('SELECT sent_count, failed_count FROM blasts WHERE id=$1', [b.data.blast_id]);
  assert.equal(row.sent_count, 30);
  assert.equal(row.failed_count, 0);
  // {{nama}} diambil dari contacts.name (termasuk nama buatan user yang tidak ditimpa saat import)
  assert.ok(
    sent.every((s) => /^Halo (Calon \d-\d+|Nama Custom User), pendaftaran dibuka!$/.test(s.text)),
    'variabel {{nama}} terisi dari kontak'
  );

  // sekarang semuanya sudah pernah dikirimi
  const after = (await call('GET', `/api/segmentation/runs/${runId}/segments/${no}/members`, { token: tokenA })).data;
  assert.ok(after.members.every((m) => m.last_sent_at !== null));
});

/* ───────────────────────── hapus ───────────────────────── */

test('hapus run menghapus segmen & anggota (cascade), prospek & kontak tetap ada', async () => {
  const before = (await pool.query('SELECT COUNT(*)::int n FROM prospects WHERE user_id=$1', [idA])).rows[0].n;
  assert.equal((await call('DELETE', `/api/segmentation/runs/${runId}`, { token: tokenA })).status, 200);

  const { rows: seg } = await pool.query('SELECT COUNT(*)::int n FROM cluster_segments WHERE run_id=$1', [runId]);
  assert.equal(seg[0].n, 0);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM prospects WHERE user_id=$1', [idA])).rows[0].n, before);
  assert.equal((await call('GET', `/api/segmentation/runs/${runId}`, { token: tokenA })).status, 404);
});

/* ───────────────────────── reset data ───────────────────────── */

test('reset: butuh JWT, dan aman dipanggil pada data kosong', async () => {
  assert.equal((await call('DELETE', '/api/segmentation/prospects')).status, 401);
  const r = await call('DELETE', '/api/segmentation/prospects', { token: tokenB });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.prospects, r.data.runs, r.data.contacts], [0, 0, 0]);
});

test('summary melaporkan jumlah kontak yang dibuat oleh import (bukan yang sudah ada sebelumnya)', async () => {
  const sum = (await call('GET', '/api/segmentation/prospects/summary', { token: tokenA })).data;
  assert.equal(sum.total, 90);
  // 89 prospek dengan kontak baru + 1 kontak "Atribut Kosong" (prospeknya sudah dihapus, tapi kontaknya tetap tercatat).
  // Kontak "Nama Custom User" sudah ada sebelum import → tidak dihitung.
  assert.equal(sum.created_contacts, 90);
});

test('reset tanpa hapus kontak: prospek & hasil cluster hilang, kontak tetap; user lain tidak terpengaruh', async () => {
  await call('POST', '/api/segmentation/prospects/import', { token: tokenB, body: { rows: makeRows(2) } });
  await call('POST', '/api/segmentation/runs', { token: tokenA, body: { k: 3 } });
  const contactsBefore = (await pool.query('SELECT COUNT(*)::int n FROM contacts WHERE user_id=$1', [idA])).rows[0].n;

  const r = await call('DELETE', '/api/segmentation/prospects', { token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.data.prospects, 90);
  assert.equal(r.data.runs, 1);
  assert.equal(r.data.contacts, 0);

  assert.equal((await call('GET', '/api/segmentation/prospects/summary', { token: tokenA })).data.total, 0);
  assert.equal((await call('GET', '/api/segmentation/runs', { token: tokenA })).data.runs.length, 0);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM contacts WHERE user_id=$1', [idA])).rows[0].n, contactsBefore, 'kontak tidak dihapus');

  // user B tidak terpengaruh
  assert.equal((await call('GET', '/api/segmentation/prospects/summary', { token: tokenB })).data.total, 6);
});

test('reset + hapus kontak: hanya kontak yang dibuat import yang terhapus; kontak lama & riwayat blast aman', async () => {
  // kontak yang sudah ada sebelum import
  await pool.query(`INSERT INTO contacts (user_id, name, phone_number) VALUES ($1, 'Kontak Lama', '6289900000005')`, [idA]);

  const rows = [
    { name: 'Baru 1', phone_number: '0899-0000-0002', program_studi: 'Manajemen', asal_sekolah: 'SMA 1', jurusan_sekolah: 'IPS', domisili: 'Kota Medan' },
    { name: 'Baru 2', phone_number: '0899-0000-0003', program_studi: 'Manajemen', asal_sekolah: 'SMA 1', jurusan_sekolah: 'IPS', domisili: 'Kota Medan' },
    { name: 'Nama Import', phone_number: '0899-0000-0005', program_studi: 'Manajemen', asal_sekolah: 'SMA 1', jurusan_sekolah: 'IPS', domisili: 'Kota Medan' }, // = Kontak Lama
  ];
  const imp = await call('POST', '/api/segmentation/prospects/import', { token: tokenA, body: { rows } });
  assert.equal(imp.data.summary.imported, 3);

  const sum = (await call('GET', '/api/segmentation/prospects/summary', { token: tokenA })).data;
  // 90 dari import sebelumnya (tetap tercatat setelah Reset biasa) + 2 baru; "Kontak Lama" tidak dihitung
  assert.equal(sum.created_contacts, 92);

  // riwayat blast yang merujuk salah satu kontak hasil import
  const { rows: [c] } = await pool.query(`SELECT id FROM contacts WHERE user_id=$1 AND phone_number='6289900000002'`, [idA]);
  const { rows: [b] } = await pool.query(
    `INSERT INTO blasts (user_id, name, total_contacts, status) VALUES ($1, 'Riwayat', 1, 'completed') RETURNING id`, [idA]
  );
  await pool.query(
    `INSERT INTO blast_messages (blast_id, contact_id, phone_number, message_body, status) VALUES ($1, $2, '6289900000002', 'hi', 'sent')`,
    [b.id, c.id]
  );

  const r = await call('DELETE', '/api/segmentation/prospects', { token: tokenA, query: { delete_contacts: 'true' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.prospects, 3);
  assert.equal(r.data.contacts, 92, 'semua kontak yang dibuat oleh import (juga dari import sebelumnya)');

  // yang tersisa hanya kontak yang sudah ada sebelum import: "Nama Custom User" & "Kontak Lama"
  const { rows: left } = await pool.query(`SELECT name FROM contacts WHERE user_id=$1 ORDER BY name`, [idA]);
  assert.deepEqual(left.map((x) => x.name), ['Kontak Lama', 'Nama Custom User'], 'kontak lama tidak disentuh & namanya tidak ditimpa');
  assert.equal((await call('GET', '/api/segmentation/prospects/summary', { token: tokenA })).data.created_contacts, 0);

  const { rows: hist } = await pool.query(`SELECT contact_id, status FROM blast_messages WHERE blast_id=$1`, [b.id]);
  assert.equal(hist.length, 1, 'riwayat blast tetap ada');
  assert.equal(hist[0].contact_id, null);

  // user B tetap utuh
  assert.equal((await call('GET', '/api/segmentation/prospects/summary', { token: tokenB })).data.total, 6);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM contacts WHERE user_id=$1', [idB])).rows[0].n, 6);
});

test('setelah reset, import baru memulai dataset dari nol (tidak menumpuk)', async () => {
  const imp = await call('POST', '/api/segmentation/prospects/import', { token: tokenA, body: { rows: makeRows(3) } });
  assert.equal(imp.data.summary.imported, 9);
  assert.equal((await call('GET', '/api/segmentation/prospects/summary', { token: tokenA })).data.total, 9);

  await call('DELETE', '/api/segmentation/prospects', { token: tokenA });
  const imp2 = await call('POST', '/api/segmentation/prospects/import', { token: tokenA, body: { rows: makeRows(2) } });
  assert.equal(imp2.data.summary.imported, 6);
  assert.equal((await call('GET', '/api/segmentation/prospects/summary', { token: tokenA })).data.total, 6, 'bukan 15');
});

test('Reset biasa lalu hapus kontak belakangan: penanda kontak hasil import tidak hilang', async () => {
  // mulai dari keadaan bersih (tes sebelumnya meninggalkan data)
  await call('DELETE', '/api/segmentation/prospects', { token: tokenA, query: { delete_contacts: 'true' } });

  const rows = [1, 2, 3].map((i) => ({
    name: `Tunda ${i}`, phone_number: `0898-0000-000${i}`, program_studi: 'Manajemen', asal_sekolah: 'SMA 1', jurusan_sekolah: 'IPS', domisili: 'Kota Medan',
  }));
  await call('POST', '/api/segmentation/prospects/import', { token: tokenA, body: { rows } });

  // 1) reset biasa: prospek hilang, kontak (dan penandanya) tetap
  const plain = await call('DELETE', '/api/segmentation/prospects', { token: tokenA });
  assert.equal(plain.data.prospects, 3);
  const mid = (await call('GET', '/api/segmentation/prospects/summary', { token: tokenA })).data;
  assert.equal(mid.total, 0);
  assert.equal(mid.created_contacts, 3, 'kontak hasil import masih tercatat walau prospeknya sudah tidak ada');
  assert.equal((await pool.query(`SELECT COUNT(*)::int n FROM contacts WHERE user_id=$1 AND name LIKE 'Tunda %'`, [idA])).rows[0].n, 3);

  // 2) import ulang nomor yang sama tidak menghilangkan/menggandakan penanda
  await call('POST', '/api/segmentation/prospects/import', { token: tokenA, body: { rows } });
  assert.equal((await call('GET', '/api/segmentation/prospects/summary', { token: tokenA })).data.created_contacts, 3);

  // 3) belakangan: reset + hapus kontak → ketiganya terhapus
  const del = await call('DELETE', '/api/segmentation/prospects', { token: tokenA, query: { delete_contacts: 'true' } });
  assert.equal(del.data.contacts, 3);
  assert.equal((await pool.query(`SELECT COUNT(*)::int n FROM contacts WHERE user_id=$1 AND name LIKE 'Tunda %'`, [idA])).rows[0].n, 0);

  // 4) dan bisa dipanggil hanya untuk membersihkan kontak, walau dataset sudah kosong
  const again = await call('DELETE', '/api/segmentation/prospects', { token: tokenA, query: { delete_contacts: 'true' } });
  assert.deepEqual([again.data.prospects, again.data.contacts], [0, 0]);
});
