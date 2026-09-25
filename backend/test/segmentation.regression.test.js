/**
 * Regresi modul Segmentasi (black-box lewat HTTP + Postgres asli):
 * dataset kotor 120 baris nyata (fixtures/data-kotor-120.csv), imputasi missing, ILKOM, fitur One-Hot dinamis,
 * evaluasi K, validasi K, target campaign tanpa pemotongan (>60 / >500), dan skala 300/500/1000 baris.
 *
 * Run: npm test
 */
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'kirimly_test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const pool = require('../src/config/database');
const app = require('../src/app');
const waSessionManager = require('../src/services/waSessionManager');
const { hashPassword } = require('../src/utils/password');
const { ATTRS } = require('../src/segmentation/validate');
const { oneHotEncode } = require('../src/segmentation/oneHot');

const suffix = Date.now().toString(36);
const U = { username: `reg_${suffix}`, password: 'passwordReg1' };
let server, base, token, userId;

async function call(method, urlPath, { tok = token, body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(query) : '';
  const res = await fetch(`${base}${urlPath}${qs}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const IMPORT = '/api/segmentation/prospects/import';
const SUMMARY = '/api/segmentation/prospects/summary';
const BATCH = 500;

/** Import per batch 500 (seperti client) dengan import_id yang sama. Mengembalikan agregat & id import. */
async function importAll(rows) {
  let importId = null;
  const agg = { total: 0, valid: 0, invalid: 0, duplicates: 0, imported: 0, updated: 0, imputed: 0 };
  for (let i = 0; i < rows.length; i += BATCH) {
    const body = { rows: rows.slice(i, i + BATCH) };
    if (importId) body.import_id = importId;
    const r = await call('POST', IMPORT, { body });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    importId = r.data.import_id;
    const s = r.data.summary;
    for (const k of ['total', 'valid', 'invalid', 'duplicates', 'imported', 'updated']) agg[k] += s[k];
    agg.imputed += s.imputed_rows;
  }
  return { agg, importId };
}

async function reset() {
  const r = await call('DELETE', '/api/segmentation/prospects', { query: { delete_contacts: 'true' } });
  assert.equal(r.status, 200);
}

function loadFixture() {
  const lines = fs.readFileSync(path.join(__dirname, 'fixtures/data-kotor-120.csv'), 'utf-8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((l) => {
    const [name, phone_number, program_studi, asal_sekolah, jurusan_sekolah, domisili] = l.split(',');
    return { name, phone_number, program_studi, asal_sekolah, jurusan_sekolah, domisili };
  });
}

// PRNG ber-seed untuk dataset sintetis yang reproducible
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const POOLS = {
  program_studi: ['Teknik Informatika', 'Sistem Informasi', 'Manajemen', 'Akuntansi', 'Ilmu Hukum', 'Psikologi', 'Ilmu Komunikasi'],
  asal_sekolah: ['SMA Negeri 1 Depok', 'SMA Negeri 2 Bogor', 'SMK Negeri 4 Bandung', 'SMA Swasta Harapan Medan', 'SMA Negeri 3 Kota Tangerang', 'SMK Pustek Serpong', 'SMA Yadika 6', 'SMA Negeri 1 Cisauk'],
  jurusan_sekolah: ['IPA', 'IPS', 'Bahasa', 'Multimedia', 'Akuntansi', 'Rekayasa Perangkat Lunak', 'Teknik Komputer dan Jaringan'],
  domisili: ['Depok', 'Bogor', 'Bandung', 'Medan', 'Kota Tangerang', 'Tangerang Selatan', 'Jakarta Selatan', 'Bekasi'],
};
function synthetic(n, seed = 7, prefix = '0851') {
  const rand = rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    name: `Sintetis ${seed}-${i}`,
    phone_number: `${prefix}${String(i).padStart(7, '0')}`,
    ...Object.fromEntries(ATTRS.map((a) => [a, POOLS[a][Math.floor(rand() * POOLS[a].length)]])),
  }));
}

before(async () => {
  const setup = spawnSync(process.execPath, [path.join(__dirname, '../scripts/setup-db.js')], { encoding: 'utf-8' });
  assert.equal(setup.status, 0, 'test DB setup failed: ' + setup.stdout + setup.stderr);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
    [U.username, await hashPassword(U.password)]
  );
  userId = rows[0].id;
  const login = await call('POST', '/api/auth/login', { tok: null, body: U });
  token = login.data.token;
});

after(async () => {
  waSessionManager.sessions.clear();
  await pool.query('DELETE FROM users WHERE username = $1', [U.username]);
  await pool.end();
  server.closeAllConnections();
  server.close();
});

/* ───────────────────────── login ───────────────────────── */

test('login: kredensial benar → token; salah → 401; tanpa token ke endpoint segmentasi → 401', async () => {
  const ok = await call('POST', '/api/auth/login', { tok: null, body: U });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  assert.equal((await call('POST', '/api/auth/login', { tok: null, body: { ...U, password: 'salah-banget' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { tok: null, body: { username: 'tidak-ada', password: 'x' } })).status, 401);
  assert.equal((await call('GET', SUMMARY, { tok: null })).status, 401);
});

/* ───────────────────────── dataset 120 baris ───────────────────────── */

let fixtureRun, fixtureImport;
const report = {};

test('import 120 baris → 113 valid, 3 duplikat, 4 invalid; missing diimputasi; seluruh 113 ikut clustering', async () => {
  const rows = loadFixture();
  assert.equal(rows.length, 120);

  const dry = await call('POST', IMPORT, { body: { rows }, query: { dry_run: 'true' } });
  assert.equal(dry.status, 200);
  assert.deepEqual([dry.data.summary.total, dry.data.summary.valid, dry.data.summary.duplicates, dry.data.summary.invalid], [120, 113, 3, 4]);

  const { agg, importId } = await importAll(rows);
  fixtureImport = importId;
  assert.deepEqual([agg.total, agg.valid, agg.duplicates, agg.invalid], [120, 113, 3, 4]);

  const s = (await call('GET', SUMMARY)).data;
  assert.equal(s.total, 113);
  assert.deepEqual([s.imports.total_rows, s.imports.valid_rows, s.imports.duplicate_rows, s.imports.invalid_rows], [120, 113, 3, 4]);

  // missing asli tetap dicatat …
  const missingTotal = Object.values(s.imports.missing).reduce((a, b) => a + b, 0);
  assert.ok(missingTotal > 0, 'missing asli tercatat di laporan');
  const unknownRows = (await pool.query(
    `SELECT COUNT(*)::int n FROM prospects WHERE user_id=$1 AND (${ATTRS.map((a) => `${a}='Tidak Diketahui'`).join(' OR ')})`, [userId]
  )).rows[0].n;
  assert.ok(unknownRows > 0 && unknownRows <= missingTotal);
  assert.equal(s.clustering.imputed, unknownRows);
  // … tetapi seluruh 113 data valid dipakai clustering
  assert.equal(s.clustering.complete, 113);
  assert.equal(s.clustering.excluded, 0);
  report.import = { total: 120, valid: 113, duplicates: 3, invalid: 4, missing: s.imports.missing, imputed_rows: unknownRows };
});

test('normalisasi ILKOM → Ilmu Komunikasi (bukan Ilmu Komputer); laporan memuat asli, baku, status, jumlah', async () => {
  const s = (await call('GET', SUMMARY)).data;
  const changes = s.normalization.program_studi.changes.filter((c) => c.original.toLowerCase() === 'ilkom');
  assert.ok(changes.length > 0, 'ILKOM tercatat di laporan');
  for (const c of changes) {
    assert.equal(c.value, 'Ilmu Komunikasi');
    assert.equal(c.status, 'mapped');
    assert.ok(c.count >= 1);
  }
  const { rows } = await pool.query(`SELECT DISTINCT program_studi FROM prospects WHERE user_id=$1`, [userId]);
  const prodi = rows.map((r) => r.program_studi);
  assert.ok(prodi.includes('Ilmu Komunikasi'));
  assert.ok(!prodi.includes('Ilmu Komputer'), 'ILKOM tidak lagi menjadi Ilmu Komputer');
  assert.ok(!prodi.some((p) => /^ilkom$/i.test(p)));
});

test('One-Hot: fitur dihitung dinamis dari data aktual; nama & nomor tidak ikut', async () => {
  const s = (await call('GET', SUMMARY)).data;
  const { rows } = await pool.query(`SELECT ${ATTRS.join(', ')} FROM prospects WHERE user_id=$1 ORDER BY id`, [userId]);
  const { columns } = oneHotEncode(rows, ATTRS);
  assert.equal(s.clustering.feature_count, columns.length, 'jumlah fitur = hasil encoding data aktual');
  assert.equal(Object.values(s.clustering.features_by_attr).reduce((a, b) => a + b, 0), columns.length);
  assert.deepEqual(Object.keys(s.clustering.features_by_attr).sort(), [...ATTRS].sort());
  report.features = { total: columns.length, by_attr: s.clustering.features_by_attr };
});

test('evaluasi K=2..6: SSE, Silhouette, DBI numerik + rekomendasi per metrik dan alasan', async () => {
  const r = await call('GET', '/api/segmentation/suggest-k');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data;
  assert.equal(d.n_samples, 113);
  assert.deepEqual(d.scores.map((x) => x.k), [2, 3, 4, 5, 6]);
  for (const x of d.scores) {
    for (const m of ['inertia', 'silhouette', 'davies_bouldin']) {
      assert.equal(typeof x[m], 'number', `${m} K=${x.k}`);
      assert.ok(Number.isFinite(x[m]));
    }
  }
  assert.deepEqual(Object.keys(d.recommendation.per_metric).sort(), ['davies_bouldin', 'elbow', 'silhouette']);
  assert.ok(d.recommendation.rationale && d.recommendation.rationale.length > 10);
  assert.ok(d.scores.some((x) => x.k === d.recommendation.k));
  report.evaluation = { scores: d.scores, per_metric: d.recommendation.per_metric, recommended: d.recommendation.k, agreement: d.recommendation.agreement };
});

test('K tidak sah ditolak (400): 1, 0, negatif, > batas, desimal, teks, kosong', async () => {
  for (const k of [1, 0, -3, 11, 99, 2.5, 'abc', null]) {
    const r = await call('POST', '/api/segmentation/runs', { body: { k } });
    assert.equal(r.status, 400, `k=${JSON.stringify(k)} harus ditolak`);
  }
  assert.equal((await call('POST', '/api/segmentation/runs', { body: {} })).status, 400);
});

test('run K terpilih: 113 sampel, total anggota = sampel, metrik/iterasi/seed/fitur tersimpan, dapat dimuat ulang', async () => {
  const k = report.evaluation.recommended;
  const r = await call('POST', '/api/segmentation/runs', { body: { k, name: 'Regresi 120' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const run = r.data.run;
  fixtureRun = run;

  assert.equal(run.n_samples, 113);
  assert.equal(run.preprocessing.used_for_clustering, 113);
  assert.equal(run.preprocessing.excluded_missing, 0);
  assert.equal(run.segments.reduce((a, s) => a + s.size, 0), run.n_samples, 'total anggota cluster = jumlah sampel');
  assert.ok(run.k >= 2);
  assert.ok(Number.isInteger(run.iterations) && run.iterations > 0);
  assert.ok(Number.isInteger(run.seed));
  for (const m of ['inertia', 'silhouette', 'davies_bouldin']) assert.equal(typeof run[m], 'number', m);
  assert.equal(run.params.feature_count, report.features.total);
  assert.deepEqual(run.params.attributes, ATTRS);
  assert.ok(!JSON.stringify(run.params).match(/phone_number|"name"/), 'identitas tidak menjadi fitur');
  for (const seg of run.segments) {
    assert.ok(seg.profile.dominant && seg.profile.distribution, 'profil + distribusi tersimpan');
    for (const a of ATTRS) assert.equal(seg.profile.distribution[a].reduce((x, y) => x + y.count, 0), seg.size);
  }

  // dimuat ulang → identik
  const again = await call('GET', `/api/segmentation/runs/${run.id}`);
  assert.equal(again.status, 200);
  assert.deepEqual(again.data.run.segments.map((s) => [s.cluster_no, s.size]), run.segments.map((s) => [s.cluster_no, s.size]));
  assert.equal(again.data.run.inertia, run.inertia);
  assert.equal(again.data.run.evaluation.scores.length, 5);
  assert.equal((await call('GET', '/api/segmentation/runs')).data.runs.some((x) => x.id === run.id), true);

  report.run = { k: run.k, n: run.n_samples, seed: run.seed, iterations: run.iterations, inertia: run.inertia, silhouette: run.silhouette, davies_bouldin: run.davies_bouldin, sizes: run.segments.map((s) => s.size) };
});

test('detail anggota: jumlah baris = total cluster (per cluster & keseluruhan), dipaginasi', async () => {
  const run = fixtureRun;
  const all = await call('GET', `/api/segmentation/runs/${run.id}/details`, { query: { limit: 25, page: 1 } });
  assert.equal(all.data.pagination.total, run.n_samples);
  let seen = 0;
  for (let p = 1; p <= all.data.pagination.total_pages; p++) {
    seen += (await call('GET', `/api/segmentation/runs/${run.id}/details`, { query: { limit: 25, page: p } })).data.members.length;
  }
  assert.equal(seen, run.n_samples);
  for (const seg of run.segments) {
    const c = await call('GET', `/api/segmentation/runs/${run.id}/details`, { query: { cluster: seg.cluster_no, limit: 500 } });
    assert.equal(c.data.pagination.total, seg.size);
    assert.equal(c.data.members.length, seg.size);
  }
});

/* ───────────────────────── target campaign ───────────────────────── */

async function fetchAllMembers(runId, no, limit = 500) {
  const first = await call('GET', `/api/segmentation/runs/${runId}/segments/${no}/members`, { query: { page: 1, limit } });
  assert.equal(first.status, 200);
  const members = [...first.data.members];
  for (let p = 2; p <= first.data.pagination.total_pages; p++) {
    members.push(...(await call('GET', `/api/segmentation/runs/${runId}/segments/${no}/members`, { query: { page: p, limit } })).data.members);
  }
  return { eligible: first.data.eligible, members, pages: first.data.pagination.total_pages };
}

test('target campaign: cluster >60 anggota tidak terpotong (paginasi)', async () => {
  await reset();
  // 1 kelompok seragam 130 baris + kelompok lain 20 baris → cluster terbesar 130
  const big = Array.from({ length: 130 }, (_, i) => ({ name: `Besar ${i}`, phone_number: `08521${String(i).padStart(7, '0')}`, program_studi: 'Manajemen', asal_sekolah: 'SMA Negeri 1 Depok', jurusan_sekolah: 'IPS', domisili: 'Depok' }));
  const small = Array.from({ length: 20 }, (_, i) => ({ name: `Kecil ${i}`, phone_number: `08522${String(i).padStart(7, '0')}`, program_studi: 'Ilmu Hukum', asal_sekolah: 'SMK Negeri 4 Bandung', jurusan_sekolah: 'Bahasa', domisili: 'Bandung' }));
  await importAll([...big, ...small]);
  const run = (await call('POST', '/api/segmentation/runs', { body: { k: 2 } })).data.run;
  const seg = run.segments.find((s) => s.size === 130);
  assert.ok(seg, 'cluster 130 anggota terbentuk');

  // Blokir 4 kontak → eligible = 126
  await pool.query(`UPDATE contacts SET is_blocked=TRUE WHERE id IN (SELECT id FROM contacts WHERE user_id=$1 AND name LIKE 'Besar %' ORDER BY id LIMIT 4)`, [userId]);

  // limit kecil memaksa banyak halaman; hasil tetap lengkap tanpa duplikat
  const got = await fetchAllMembers(run.id, seg.cluster_no, 50);
  assert.equal(got.eligible, 126);
  assert.equal(got.members.length, 126);
  assert.equal(new Set(got.members.map((m) => m.contact_id)).size, 126, 'tanpa duplikat antar-halaman');
  assert.ok(got.members.length > 60);
  assert.ok(got.pages >= 3);
  // limit default (tanpa parameter) juga tidak memotong di 60
  const def = await call('GET', `/api/segmentation/runs/${run.id}/segments/${seg.cluster_no}/members`);
  assert.equal(def.data.members.length, 126);
});

test('target campaign: cluster >500 anggota tidak terpotong', async () => {
  await reset();
  const big = Array.from({ length: 620 }, (_, i) => ({ name: `Raksasa ${i}`, phone_number: `08531${String(i).padStart(7, '0')}`, program_studi: 'Akuntansi', asal_sekolah: 'SMA Negeri 2 Bogor', jurusan_sekolah: 'IPS', domisili: 'Bogor' }));
  const small = Array.from({ length: 30 }, (_, i) => ({ name: `Mini ${i}`, phone_number: `08532${String(i).padStart(7, '0')}`, program_studi: 'Psikologi', asal_sekolah: 'SMA Yadika 6', jurusan_sekolah: 'IPA', domisili: 'Bekasi' }));
  await importAll([...big, ...small]);
  const run = (await call('POST', '/api/segmentation/runs', { body: { k: 2 } })).data.run;
  const seg = run.segments.find((s) => s.size === 620);
  assert.ok(seg);

  const got = await fetchAllMembers(run.id, seg.cluster_no, 500);
  assert.equal(got.eligible, 620);
  assert.equal(got.members.length, 620, 'tidak terpotong di 500');
  assert.equal(new Set(got.members.map((m) => m.contact_id)).size, 620);
  assert.equal(got.pages, 2);
});

/* ───────────────────────── skala ───────────────────────── */

for (const n of [300, 500, 1000]) {
  test(`skala ${n} baris: import (batch 500), evaluasi K, clustering, anggota — tanpa kehilangan data`, async () => {
    await reset();
    const rows = synthetic(n, n);
    const t0 = Date.now();
    const { agg } = await importAll(rows);
    const tImport = Date.now() - t0;
    assert.deepEqual([agg.total, agg.valid, agg.invalid, agg.duplicates], [n, n, 0, 0]);
    assert.equal((await pool.query('SELECT COUNT(*)::int n FROM prospects WHERE user_id=$1', [userId])).rows[0].n, n);
    assert.equal((await pool.query('SELECT COUNT(*)::int n FROM contacts WHERE user_id=$1', [userId])).rows[0].n, n);

    const t1 = Date.now();
    const ev = (await call('GET', '/api/segmentation/suggest-k')).data;
    const tEval = Date.now() - t1;
    assert.equal(ev.n_samples, n);
    assert.deepEqual(ev.scores.map((x) => x.k), [2, 3, 4, 5, 6]);

    const t2 = Date.now();
    const runRes = await call('POST', '/api/segmentation/runs', { body: { k: ev.recommendation.k } });
    const tRun = Date.now() - t2;
    assert.equal(runRes.status, 201, JSON.stringify(runRes.data));
    const run = runRes.data.run;
    assert.equal(run.n_samples, n);
    assert.equal(run.segments.reduce((a, s) => a + s.size, 0), n);

    const detail = await call('GET', `/api/segmentation/runs/${run.id}/details`, { query: { limit: 500 } });
    assert.equal(detail.data.pagination.total, n);
    let members = 0;
    for (const seg of run.segments) members += (await fetchAllMembers(run.id, seg.cluster_no)).eligible;
    assert.equal(members, n, 'seluruh kontak eligible terpilih sebagai target');

    // duplikat antar-batch pada import yang sama: nomor yang sudah masuk batch sebelumnya dilewati, tidak ada data hilang
    const { importId } = await importAll(synthetic(10, 999, '0861'));
    const again = await call('POST', IMPORT, { body: { rows: synthetic(10, 999, '0861'), import_id: importId } });
    assert.equal(again.data.summary.duplicates, 10);
    assert.equal(again.data.summary.valid, 0);
    assert.equal((await pool.query('SELECT COUNT(*)::int n FROM prospects WHERE user_id=$1', [userId])).rows[0].n, n + 10);

    report[`scale_${n}`] = { rows: n, features: run.params.feature_count, k: run.k, ms_import: tImport, ms_eval_k: tEval, ms_run: tRun, sizes: run.segments.map((s) => s.size) };
    assert.ok(tEval < 30000 && tRun < 30000, 'evaluasi & clustering selesai dalam batas request (tanpa perlu background job)');
  });
}

test('laporan post-fix (info)', () => {
  console.log('\n=== POST-FIX REPORT ===\n' + JSON.stringify(report, null, 1));
});
