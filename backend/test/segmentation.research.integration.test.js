/**
 * Integrasi alur penelitian segmentasi terhadap Postgres asli (DB test terpisah):
 * dry-run preprocessing, import per-batch + riwayat, missing dikeluarkan dari clustering,
 * evaluasi K (SSE/Silhouette/DBI), metrik tersimpan, detail anggota, reset.
 *
 * Run: npm test
 */
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'kirimly_test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const pool = require('../src/config/database');
const app = require('../src/app');
const waSessionManager = require('../src/services/waSessionManager');
const { hashPassword } = require('../src/utils/password');

const suffix = Date.now().toString(36);
const A = { username: `res_a_${suffix}`, password: 'passwordA1' };
const B = { username: `res_b_${suffix}`, password: 'passwordB1' };
let server, base, tokenA, tokenB, idA;

async function call(method, urlPath, { token, body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(query) : '';
  const res = await fetch(`${base}${urlPath}${qs}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
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

/* ── dataset kotor: 3 kelompok × 20 dengan penulisan bervariasi + berbagai jenis kotoran ── */
const G = [
  { prodi: ['Teknik Informatika', 'TI', 'S1 Teknik Informatika'], sekolah: ['SMAN 1 Tangsel', 'SMA Negeri 1 Tangerang Selatan', 'sman1 tangsel'], jurusan: ['IPA', 'MIPA', 'ipa'], kota: ['Tangsel', 'Kota Tangerang Selatan', 'tangerang selatan'] },
  { prodi: ['Manajemen', 'manajemen'], sekolah: ['SMK Negeri 2 Surabaya', 'SMKN 2 Surabaya'], jurusan: ['Akuntansi', 'AKL'], kota: ['Kota Surabaya', 'kota surabaya'] },
  { prodi: ['Ilmu Hukum', 'hukum'], sekolah: ['SMA Swasta Harapan Medan', 'sma swasta harapan medan'], jurusan: ['IPS', 'Ilmu Pengetahuan Sosial'], kota: ['Kota Medan', 'kota medan'] },
];
const phone = (g, i) => `08${g + 1}${String(i).padStart(8, '0')}`; // 11 digit, unik per (g,i)

function makeDataset() {
  const rows = [];
  G.forEach((g, gi) => {
    for (let i = 0; i < 20; i++) {
      rows.push({
        name: `Calon ${gi}-${i}`,
        phone_number: phone(gi, i),
        program_studi: g.prodi[i % g.prodi.length],
        asal_sekolah: g.sekolah[i % g.sekolah.length],
        jurusan_sekolah: g.jurusan[i % g.jurusan.length],
        domisili: g.kota[i % g.kota.length],
      });
    }
  });
  // variasi kecil agar sebaran cluster tidak persis 0
  rows[5].domisili = 'Kota Jakarta';
  rows[31].jurusan_sekolah = 'Bahasa';
  rows[47].program_studi = 'Psikologi';
  // typo domisili (nilai mirip 'Tangerang Selatan', TIDAK boleh digabung otomatis)
  rows[1].domisili = 'Tanggerang Selatan';
  rows[4].domisili = 'Tanggerang Selatan';
  // nomor Excel tanpa nol depan (2 baris)
  rows[10].phone_number = phone(0, 10).slice(1);
  rows[11].phone_number = phone(0, 11).slice(1);
  // missing value: program studi kosong (3 baris) → tersimpan tapi tidak ikut clustering
  rows[12].program_studi = '';
  rows[13].program_studi = '   ';
  rows[14].program_studi = null;
  // invalid: nomor rusak, notasi ilmiah, nama kosong
  rows.push({ name: 'Nomor Rusak', phone_number: '12345', program_studi: 'Manajemen', asal_sekolah: 'SMA 1', jurusan_sekolah: 'IPS', domisili: 'Kota Medan' });
  rows.push({ name: 'Ilmiah', phone_number: '8.12E+10', program_studi: 'Manajemen', asal_sekolah: 'SMA 1', jurusan_sekolah: 'IPS', domisili: 'Kota Medan' });
  rows.push({ name: '', phone_number: '081999999999', program_studi: 'Manajemen', asal_sekolah: 'SMA 1', jurusan_sekolah: 'IPS', domisili: 'Kota Medan' });
  // duplikat dalam file: nomor sama dengan baris pertama
  rows.push({ ...rows[0], name: 'Duplikat Nomor' });
  return rows;
}

before(async () => {
  const setup = spawnSync(process.execPath, [path.join(__dirname, '../scripts/setup-db.js')], { encoding: 'utf-8' });
  assert.equal(setup.status, 0, 'test DB setup failed: ' + setup.stdout + setup.stderr);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  ({ id: idA, token: tokenA } = await createUser(A));
  ({ token: tokenB } = await createUser(B));
});

after(async () => {
  waSessionManager.sessions.clear();
  await pool.query('DELETE FROM users WHERE username = ANY($1)', [[A.username, B.username]]);
  await pool.end();
  server.closeAllConnections();
  server.close();
});

const IMPORT = '/api/segmentation/prospects/import';
const SUMMARY = '/api/segmentation/prospects/summary';
let dataset, valid, complete, importId, runId;

/* ───────────────────────── dry run ───────────────────────── */

test('dry_run: ringkasan preprocessing lengkap, TIDAK menulis apa pun ke database', async () => {
  dataset = makeDataset();
  const r = await call('POST', IMPORT, { token: tokenA, body: { rows: dataset }, query: { dry_run: 'true' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.dry_run, true);

  const s = r.data.summary;
  assert.equal(s.total, 64);              // 60 + 3 invalid + 1 duplikat
  assert.equal(s.invalid, 3);
  assert.equal(s.duplicates, 1);
  assert.equal(s.valid, 60);
  assert.equal(s.phone_fixed, 2, 'dua nomor tanpa nol depan diperbaiki');
  assert.equal(s.missing_attributes.program_studi, 3);
  assert.equal(s.excluded_from_clustering, 3);
  assert.equal(s.imported, 60, 'belum ada di DB → semua akan menjadi data baru');
  assert.deepEqual(r.data.errors.map((e) => e.code).sort(), ['empty', 'phone', 'scientific']);

  // laporan normalisasi menyertakan Tangsel → Tangerang Selatan
  const change = r.data.normalization.domisili.changes.find((c) => c.original === 'Tangsel');
  assert.deepEqual([change.value, change.status], ['Tangerang Selatan', 'mapped']);

  // tidak ada yang tertulis
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM prospects WHERE user_id=$1', [idA])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM contacts WHERE user_id=$1', [idA])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM segmentation_imports WHERE user_id=$1', [idA])).rows[0].n, 0);
});

/* ───────────────────────── import per-batch + riwayat ───────────────────────── */

test('import 2 batch dengan import_id yang sama → SATU riwayat, angka dijumlahkan', async () => {
  // Alur nyata: client membuang duplikat lintas-sheet SEBELUM mengirim per-batch dan melaporkannya
  // lewat meta.extra_duplicates (di sini: baris duplikat terakhir + 2 duplikat antar-sheet lain).
  const toSend = dataset.slice(0, -1);
  const half = 32;
  const first = await call('POST', IMPORT, {
    token: tokenA,
    body: { rows: toSend.slice(0, half), meta: { source_name: 'dataset-uji.xlsx', sheets: [{ name: 'Gelombang 1', rows: 40, used: true }, { name: 'Gelombang 2', rows: 24, used: true }], extra_duplicates: 3 } },
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  importId = first.data.import_id;
  assert.ok(importId);

  const second = await call('POST', IMPORT, { token: tokenA, body: { rows: toSend.slice(half), import_id: importId } });
  assert.equal(second.status, 201);
  assert.equal(second.data.import_id, importId);

  const { rows: logs } = await pool.query('SELECT * FROM segmentation_imports WHERE user_id=$1', [idA]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].source_name, 'dataset-uji.xlsx');
  assert.equal(logs[0].total_rows, 66, '63 baris dikirim + 3 duplikat yang sudah dibuang client');
  assert.equal(logs[0].valid_rows, 60);
  assert.equal(logs[0].invalid_rows, 3);
  assert.equal(logs[0].duplicate_rows, 3);
  assert.equal(logs[0].missing.program_studi, 3);
  assert.deepEqual(logs[0].sheets.map((s) => s.name), ['Gelombang 1', 'Gelombang 2']);

  // import_id milik user lain ditolak
  const bad = await call('POST', IMPORT, { token: tokenB, body: { rows: dataset.slice(0, 2), import_id: importId } });
  assert.equal(bad.status, 404);
});

test('summary: data awal/valid/invalid/duplikat, missing, laporan normalisasi, nilai mirip, jumlah fitur', async () => {
  const r = await call('GET', SUMMARY, { token: tokenA });
  assert.equal(r.status, 200);
  const d = r.data;

  assert.equal(d.total, 60, '60 baris valid tersimpan (3 di antaranya tidak lengkap)');
  assert.equal(d.imports.count, 1);
  assert.deepEqual(
    [d.imports.total_rows, d.imports.valid_rows, d.imports.invalid_rows, d.imports.duplicate_rows],
    [66, 60, 3, 3]
  );

  // missing value tersimpan tapi dikeluarkan dari clustering
  assert.equal(d.clustering.complete, 57);
  assert.equal(d.clustering.excluded, 3);
  complete = d.clustering.complete;

  // jumlah fitur One-Hot dihitung dari dataset clustering, hanya 4 variabel
  assert.ok(d.clustering.feature_count > 0);
  assert.deepEqual(Object.keys(d.clustering.features_by_attr).sort(), ['asal_sekolah', 'domisili', 'jurusan_sekolah', 'program_studi']);
  assert.equal(Object.values(d.clustering.features_by_attr).reduce((s, x) => s + x, 0), d.clustering.feature_count);

  // laporan normalisasi gabungan dua batch
  const dom = d.normalization.domisili;
  assert.ok(dom.changes.some((c) => c.original === 'Tangsel' && c.value === 'Tangerang Selatan'));
  assert.ok(dom.changes.some((c) => c.original === 'Kota Tangerang Selatan' && c.value === 'Tangerang Selatan'));

  // typo ditandai (bukan digabung): kedua bentuk masih ada sebagai kategori terpisah
  const pair = d.similar_values.domisili.find((p) => [p.value, p.similar_to].includes('Tanggerang Selatan'));
  assert.ok(pair, 'nilai mirip terdeteksi');
  assert.ok([pair.value, pair.similar_to].includes('Tangerang Selatan'));
  const cats = (await pool.query(`SELECT DISTINCT domisili FROM prospects WHERE user_id=$1`, [idA])).rows.map((x) => x.domisili);
  assert.ok(cats.includes('Tangerang Selatan') && cats.includes('Tanggerang Selatan'), 'tidak digabung otomatis');
  assert.ok(!cats.includes('Tangsel') && !cats.includes('Kota Tangerang Selatan'), 'alias jelas sudah dibakukan');

  // nomor Excel tanpa nol depan tersimpan benar
  const fixed = await pool.query(`SELECT 1 FROM prospects WHERE user_id=$1 AND phone_number=$2`, [idA, '62' + phone(0, 10).slice(1)]);
  assert.equal(fixed.rowCount, 1);
});

/* ───────────────────────── evaluasi K ───────────────────────── */

test('suggest-k: tabel K 2..6 (SSE, Silhouette, DBI) dari data aktual + rekomendasi 3 metrik', async () => {
  const r = await call('GET', '/api/segmentation/suggest-k', { token: tokenA });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data;

  assert.equal(d.n_samples, complete, 'hanya baris lengkap yang dievaluasi');
  assert.ok(d.feature_count > 0);
  assert.deepEqual(d.scores.map((s) => s.k), [2, 3, 4, 5, 6]);
  for (const s of d.scores) {
    assert.equal(typeof s.inertia, 'number');
    assert.equal(typeof s.silhouette, 'number');
    assert.equal(typeof s.davies_bouldin, 'number');
  }
  for (let i = 1; i < d.scores.length; i++) assert.ok(d.scores[i].inertia <= d.scores[i - 1].inertia + 1e-9, 'SSE tidak naik');

  assert.ok(['all', 'majority', 'none'].includes(d.recommendation.agreement));
  assert.deepEqual(Object.keys(d.recommendation.per_metric).sort(), ['davies_bouldin', 'elbow', 'silhouette']);
  assert.equal(typeof d.recommendation.rationale, 'string');
  assert.equal(d.recommended, d.recommendation.k, 'field lama dipertahankan');
  // Angka K yang disarankan bergantung pada data (nilai menyimpang bisa mendorong K lebih besar);
  // yang diuji di sini: rekomendasi ada di rentang yang dievaluasi dan berasal dari metrik aktual.
  assert.ok(d.scores.some((s) => s.k === d.recommendation.k));
  const votes = Object.values(d.recommendation.per_metric).filter((k) => k != null);
  assert.ok(votes.length >= 2);
});

/* ───────────────────────── clustering ───────────────────────── */

test('run K=3: metrik lengkap tersimpan, missing tidak ikut, distribusi penuh, SSE konsisten dengan evaluasi', async () => {
  const ev = (await call('GET', '/api/segmentation/suggest-k', { token: tokenA })).data;
  const r = await call('POST', '/api/segmentation/runs', { token: tokenA, body: { k: 3, name: 'Uji Penelitian' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const run = r.data.run;
  runId = run.id;

  assert.equal(run.k, 3);
  assert.equal(run.n_samples, complete, 'baris dengan variabel kosong tidak ikut clustering');
  assert.equal(typeof run.davies_bouldin, 'number');
  assert.equal(typeof run.silhouette, 'number');
  assert.equal(run.segments.reduce((s, x) => s + x.size, 0), complete);

  // SSE run = SSE pada tabel evaluasi untuk K yang sama
  assert.equal(run.inertia, ev.scores.find((s) => s.k === 3).inertia);
  assert.equal(run.evaluation.scores.length, 5);
  assert.equal(run.evaluation.recommendation.k, ev.recommendation.k, 'evaluasi tersimpan = evaluasi yang ditampilkan');
  assert.deepEqual(run.evaluation.scores, ev.scores);

  // snapshot preprocessing tersimpan bersama hasil
  assert.equal(run.preprocessing.used_for_clustering, complete);
  assert.equal(run.preprocessing.excluded_missing, 3);
  assert.equal(run.preprocessing.imports.total_rows, 66);
  assert.equal(run.preprocessing.feature_count, run.params.feature_count);
  assert.deepEqual(run.preprocessing.variables, ['program_studi', 'asal_sekolah', 'jurusan_sekolah', 'domisili']);

  // distribusi PENUH per variabel; persen menjumlah ±100; kategori dominan bukan berarti semuanya sama
  const ti = run.segments.find((s) => s.profile.dominant.program_studi === 'Teknik Informatika');
  assert.ok(ti);
  for (const attr of ['program_studi', 'asal_sekolah', 'jurusan_sekolah', 'domisili']) {
    const dist = ti.profile.distribution[attr];
    assert.ok(dist.every((x) => x.value && x.count > 0 && typeof x.percent === 'number'));
    assert.ok(Math.abs(dist.reduce((s, x) => s + x.percent, 0) - 100) < 0.5, `${attr} ≈ 100%`);
    assert.equal(dist.reduce((s, x) => s + x.count, 0), ti.size);
  }
  // baku: Tangsel/Kota Tangerang Selatan/tangerang selatan → satu kategori; typo tetap terpisah
  const dom = Object.fromEntries(ti.profile.distribution.domisili.map((x) => [x.value, x.count]));
  assert.ok(dom['Tangerang Selatan'] >= 10);
  assert.equal(dom['Tanggerang Selatan'], 2);
  assert.ok(ti.profile.dominant.domisili === 'Tangerang Selatan');
  assert.ok(ti.profile.distribution.domisili[0].percent < 100, 'tidak semua anggota berkategori sama');

  // riwayat: run tampil di daftar dengan DBI
  const list = await call('GET', '/api/segmentation/runs', { token: tokenA });
  assert.equal(list.data.runs[0].davies_bouldin, run.davies_bouldin);
});

/* ───────────────────────── detail anggota ───────────────────────── */

test('detail anggota: nama, nomor, 4 variabel, label cluster; baris missing tidak ikut; terisolasi per user', async () => {
  const all = await call('GET', `/api/segmentation/runs/${runId}/details`, { token: tokenA, query: { limit: 500 } });
  assert.equal(all.status, 200, JSON.stringify(all.data));
  assert.equal(all.data.pagination.total, complete);
  assert.equal(all.data.members.length, complete);
  for (const m of all.data.members) {
    for (const f of ['name', 'phone_number', 'program_studi', 'asal_sekolah', 'jurusan_sekolah', 'domisili', 'cluster_no']) {
      assert.ok(m[f] !== undefined && m[f] !== null && m[f] !== '', `field ${f}`);
    }
    assert.notEqual(m.program_studi, 'Tidak Diketahui');
  }
  assert.ok(!all.data.members.some((m) => ['Calon 0-12', 'Calon 0-13', 'Calon 0-14'].includes(m.name)), 'baris missing tidak ikut clustering');

  // filter cluster + paginasi
  const c1 = await call('GET', `/api/segmentation/runs/${runId}/details`, { token: tokenA, query: { cluster: '1', limit: 5, page: 2 } });
  assert.equal(c1.data.members.length, 5);
  assert.ok(c1.data.members.every((m) => m.cluster_no === 1));
  const size1 = (await call('GET', `/api/segmentation/runs/${runId}`, { token: tokenA })).data.run.segments.find((s) => s.cluster_no === 1).size;
  assert.equal(c1.data.pagination.total, size1);

  assert.equal((await call('GET', `/api/segmentation/runs/${runId}/details`, { token: tokenB })).status, 404);
  assert.equal((await call('GET', `/api/segmentation/runs/${runId}/details`, { token: tokenA, query: { cluster: 'abc' } })).status, 400);
  assert.equal((await call('GET', `/api/segmentation/runs/${runId}/details`)).status, 401);
});

/* ───────────────────────── campaign tidak terganggu ───────────────────────── */

test('integrasi Campaign: anggota cluster tetap bisa dipilih sebagai target (endpoint lama utuh)', async () => {
  const m = await call('GET', `/api/segmentation/runs/${runId}/segments/1/members`, { token: tokenA, query: { limit: 60 } });
  assert.equal(m.status, 200);
  assert.ok(m.data.eligible > 0);
  assert.ok(m.data.members.every((x) => Number.isInteger(x.contact_id) && x.phone_number));
});

/* ───────────────────────── reset ───────────────────────── */

test('reset data juga menghapus riwayat import (angka preprocessing ikut nol)', async () => {
  const r = await call('DELETE', '/api/segmentation/prospects', { token: tokenA });
  assert.equal(r.status, 200);
  const s = (await call('GET', SUMMARY, { token: tokenA })).data;
  assert.equal(s.total, 0);
  assert.equal(s.imports.count, 0);
  assert.equal(s.imports.total_rows, 0);
  assert.equal(s.clustering.feature_count, 0);
});
