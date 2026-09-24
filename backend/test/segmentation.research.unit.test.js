/**
 * Unit test preprocessing & evaluasi untuk keperluan penelitian TA — fungsi murni, tanpa DB.
 * Run: npm test
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const n = require('../src/segmentation/normalize');
const { validateRows, ATTRS, repairPhone, isComplete } = require('../src/segmentation/validate');
const { oneHotEncode } = require('../src/segmentation/oneHot');
const { kmeans } = require('../src/segmentation/kmeans');
const { buildProfile } = require('../src/segmentation/profile');
const { daviesBouldin, findElbow, recommendK } = require('../src/segmentation/metrics');
const { buildNormalizationReport, mergeReports, similarValues } = require('../src/segmentation/report');
const { suggestK: evaluateK } = require('../src/segmentation/silhouette');

const GROUPS = [
  { program_studi: 'Teknik Informatika', asal_sekolah: 'SMA Negeri 1 Bandung', jurusan_sekolah: 'IPA', domisili: 'Kota Bandung' },
  { program_studi: 'Manajemen', asal_sekolah: 'SMK Negeri 2 Surabaya', jurusan_sekolah: 'Akuntansi', domisili: 'Kota Surabaya' },
  { program_studi: 'Ilmu Hukum', asal_sekolah: 'SMA Swasta Harapan Medan', jurusan_sekolah: 'IPS', domisili: 'Kota Medan' },
];

function syntheticRows(perGroup) {
  const rows = [];
  GROUPS.forEach((g) => {
    for (let i = 0; i < perGroup; i++) {
      const row = { ...g };
      // variasi kecil agar tidak ada cluster dengan sebaran tepat 0 (seperti data nyata)
      if (i === 5) row.domisili = 'Kota Jakarta';
      if (i === 11) row.jurusan_sekolah = 'Bahasa';
      if (i === 17) row.program_studi = 'Psikologi';
      rows.push(row);
    }
  });
  return rows;
}

/* ───────────── normalisasi & status ───────────── */

test('domisili: singkatan → bentuk baku, dengan status yang jujur', () => {
  const d = n.detailDomisili;
  assert.deepEqual([d('Tangsel').value, d('Tangsel').status], ['Tangerang Selatan', 'mapped']);
  assert.equal(d('Kota Tangerang Selatan').value, 'Tangerang Selatan');
  assert.equal(d('Tangerang Selatan, Banten').value, 'Tangerang Selatan');
  assert.equal(d('Jaksel').value, 'Jakarta Selatan');
  assert.equal(d('jaktim').value, 'Jakarta Timur');
  assert.equal(d('tangerang selatan').status, 'canonical', 'sudah baku → tidak dianggap diubah');
  // Kota vs Kabupaten yang bermakna berbeda TIDAK digabung
  assert.equal(d('Kota Bandung').value, 'Kota Bandung');
  assert.equal(d('Kab. Bandung').value, 'Kabupaten Bandung');
});

test('singkatan ambigu dipetakan tetapi DITANDAI; yang tak dikenal tidak ditebak', () => {
  assert.deepEqual([n.detailDomisili('Bks').value, n.detailDomisili('Bks').status], ['Kota Bekasi', 'ambiguous']);
  assert.equal(n.detailProgramStudi('TI').status, 'ambiguous');
  assert.equal(n.detailProgramStudi('TI').value, 'Teknik Informatika');
  const typo = n.detailDomisili('  tanggerang   ');
  assert.deepEqual([typo.value, typo.status], ['Tanggerang', 'unrecognized']);
  assert.equal(n.detailProgramStudi('sastra inggris').status, 'unrecognized');
});

test('jurusan: akronim SMK tidak dirusak, DKV tidak dilebur ke Multimedia', () => {
  assert.equal(n.normalizeJurusanSekolah('RPL'), 'Rekayasa Perangkat Lunak');
  assert.equal(n.normalizeJurusanSekolah('TKJ'), 'Teknik Komputer dan Jaringan');
  assert.equal(n.normalizeJurusanSekolah('SIJA'), 'Sistem Informatika Jaringan dan Aplikasi');
  assert.equal(n.normalizeJurusanSekolah('TITL'), 'Teknik Instalasi Tenaga Listrik');
  assert.notEqual(n.normalizeJurusanSekolah('DKV'), n.normalizeJurusanSekolah('Multimedia'));
  assert.equal(n.detailJurusanSekolah('XYZ').value, 'XYZ', 'akronim tak dikenal dipertahankan, bukan jadi "Xyz"');
  assert.equal(n.detailJurusanSekolah('XYZ').status, 'unrecognized');
});

test('asal sekolah: singkatan kota di dalam nama sekolah ikut dibakukan', () => {
  assert.equal(n.normalizeAsalSekolah('SMAN 1 Tangsel'), 'SMA Negeri 1 Tangerang Selatan');
  assert.equal(n.normalizeAsalSekolah('SMA Negeri 1 Tangerang Selatan'), 'SMA Negeri 1 Tangerang Selatan');
  assert.equal(n.detailAsalSekolah('SMAN 1 Tangsel').status, 'mapped');
  assert.equal(n.detailAsalSekolah('SMA Negeri 1 Bandung').status, 'canonical');
});

/* ───────────── validasi ───────────── */

test('nol depan hilang (Excel) diperbaiki & dihitung; notasi ilmiah & nomor rusak ditolak', () => {
  assert.deepEqual(repairPhone('81234567890'), { digits: '6281234567890', fixed: true });
  assert.equal(repairPhone('081234567890').fixed, false);

  const r = validateRows([
    { name: 'A', phone_number: 81234567890, program_studi: 'ti', asal_sekolah: 'x', jurusan_sekolah: 'rpl', domisili: 'tangsel' },
    { name: 'B', phone_number: '8.12E+10', program_studi: 'ti' },
    { name: 'C', phone_number: '12345', program_studi: 'ti' },
    { name: 'D', phone_number: '', program_studi: 'ti' },
  ]);
  assert.equal(r.valid.length, 1);
  assert.equal(r.valid[0].phone_number, '6281234567890');
  assert.equal(r.phoneFixed, 1);
  assert.deepEqual(r.invalid.map((i) => i.code).sort(), ['empty', 'phone', 'scientific']);
  assert.ok(r.events.some((e) => e.attr === 'domisili' && e.original === 'tangsel' && e.value === 'Tangerang Selatan' && e.status === 'mapped'),
    'perubahan nilai tercatat, tidak diam-diam');
});

test('missing value dihitung per variabel dan baris tidak lengkap dikenali', () => {
  const r = validateRows([
    { name: 'A', phone_number: '081234567890', program_studi: 'Manajemen', asal_sekolah: '', jurusan_sekolah: 'IPS', domisili: 'Kota Medan' },
    { name: 'B', phone_number: '081234567891', program_studi: 'Manajemen', asal_sekolah: 'SMA 1', jurusan_sekolah: 'IPS', domisili: 'Kota Medan' },
  ]);
  assert.deepEqual(r.missing, { program_studi: 0, asal_sekolah: 1, jurusan_sekolah: 0, domisili: 0 });
  assert.equal(isComplete(r.valid[0]), false);
  assert.equal(isComplete(r.valid[1]), true);
});

/* ───────────── laporan ───────────── */

test('laporan normalisasi: asli→baku + jumlah; mergeReports menjumlahkan antar-batch', () => {
  const ev = (original, value, status) => ({ attr: 'domisili', original, value, status });
  const a = buildNormalizationReport([ev('Tangsel', 'Tangerang Selatan', 'mapped'), ev('Tangsel', 'Tangerang Selatan', 'mapped'), ev('Bali', 'Bali', 'unrecognized')]);
  const b = buildNormalizationReport([ev('Tangsel', 'Tangerang Selatan', 'mapped'), ev('Depok', 'Depok', 'canonical')]);

  assert.deepEqual(a.domisili.changes, [{ original: 'Tangsel', value: 'Tangerang Selatan', status: 'mapped', count: 2 }]);
  assert.deepEqual(a.domisili.unrecognized, [{ value: 'Bali', count: 1 }]);

  const m = mergeReports(a, b);
  assert.equal(m.domisili.changes[0].count, 3);
  assert.equal(m.domisili.totals.mapped, 3);
  assert.equal(m.domisili.totals.canonical, 1);
});

test('nilai mirip (kemungkinan typo) hanya DITANDAI; sekolah beda nomor bukan typo', () => {
  const pairs = similarValues({ 'Tangerang Selatan': 40, 'Tanggerang Selatan': 3, 'SMA Negeri 1 Bandung': 30, 'SMA Negeri 2 Bandung': 20, Bekasi: 9 });
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].value, pairs[0].similar_to], ['Tangerang Selatan', 'Tanggerang Selatan']);
});

/* ───────────── metrik ───────────── */

test('Davies-Bouldin cocok dengan hitungan tangan', () => {
  // C0={0,2} pusat 1 ; C1={10,12} pusat 11 → S0=S1=1, M=10 → DBI=(1+1)/10=0.2
  const X = [[0], [2], [10], [12]].map((a) => Float64Array.from(a));
  const dbi = daviesBouldin(X, Int32Array.from([0, 0, 1, 1]), [Float64Array.from([1]), Float64Array.from([11])]);
  assert.ok(Math.abs(dbi - 0.2) < 1e-12);
  assert.equal(daviesBouldin(X, Int32Array.from([0, 0, 1, 1]), [Float64Array.from([1]), Float64Array.from([1])]), null, 'centroid berimpit → tidak terdefinisi');
});

test('Elbow: menemukan siku pada kurva SSE sintetis; tidak ada bila SSE datar / titik < 3', () => {
  const curve = [100, 40, 35, 32, 30].map((inertia, i) => ({ k: i + 2, inertia }));
  assert.equal(findElbow(curve).k, 3);
  assert.equal(findElbow(curve.map((p) => ({ ...p, inertia: 5 }))), null);
  assert.equal(findElbow(curve.slice(0, 2)), null);
});

test('rekomendasi K memakai 3 metrik: sepakat, mayoritas, dan tidak sepakat dibedakan', () => {
  const row = (k, inertia, silhouette, davies_bouldin) => ({ k, inertia, silhouette, davies_bouldin });

  const all = recommendK([row(2, 100, 0.3, 1.9), row(3, 40, 0.55, 0.9), row(4, 35, 0.4, 1.3), row(5, 32, 0.35, 1.5), row(6, 30, 0.3, 1.6)]);
  assert.equal(all.k, 3);
  assert.equal(all.agreement, 'all');
  assert.deepEqual(all.per_metric, { elbow: 3, silhouette: 3, davies_bouldin: 3 });

  // silhouette memilih 2, elbow & DBI memilih 3 → mayoritas
  const majority = recommendK([row(2, 100, 0.7, 1.4), row(3, 40, 0.5, 0.8), row(4, 35, 0.4, 1.3), row(5, 32, 0.35, 1.5), row(6, 30, 0.3, 1.6)]);
  assert.equal(majority.agreement, 'majority');
  assert.equal(majority.k, 3);

  // tiga metrik memilih tiga K berbeda → tidak sepakat, pengguna diminta memutuskan
  const none = recommendK([row(2, 100, 0.7, 1.9), row(3, 80, 0.5, 1.8), row(4, 30, 0.4, 1.7), row(5, 28, 0.35, 1.6), row(6, 26, 0.3, 0.5)]);
  assert.deepEqual(none.per_metric, { elbow: 4, silhouette: 2, davies_bouldin: 6 });
  assert.equal(none.agreement, 'none');
  assert.equal(none.needs_user_decision, true);
  assert.match(none.rationale, /tidak sepakat/i);
});

test('evaluasi K: tabel berisi SSE, Silhouette, DBI aktual + rekomendasi (kelompok sintetis jelas)', () => {
  const { matrix } = oneHotEncode(syntheticRows(20), ATTRS);
  const ev = evaluateK(matrix, { seed: 42 });

  assert.ok(ev.scores.length >= 2);
  assert.deepEqual(ev.scores.map((s) => s.k), ev.scores.map((_, i) => i + 2));
  for (const s of ev.scores) {
    assert.ok(Number.isFinite(s.inertia) && s.inertia >= 0);
    assert.ok(s.silhouette >= -1 && s.silhouette <= 1);
    assert.ok(s.davies_bouldin > 0);
  }
  assert.equal(ev.recommendation.k, 3);
  assert.equal(ev.recommended, 3, 'field lama dipertahankan');
  // SSE pada tabel = SSE eksekusi K-Means untuk K yang sama (konfigurasi identik)
  assert.equal(ev.scores.find((s) => s.k === 3).inertia, kmeans(matrix, 3, { seed: 42 }).inertia);
});

/* ───────────── profil ───────────── */

test('profil cluster: distribusi PENUH (kategori, jumlah, persen), bukan hanya dominan', () => {
  const members = [
    { program_studi: 'A', domisili: 'X' }, { program_studi: 'A', domisili: 'X' },
    { program_studi: 'B', domisili: 'Y' }, { program_studi: 'C', domisili: 'Z' },
  ];
  const p = buildProfile(members, ['program_studi', 'domisili']);
  assert.deepEqual(p.distribution.program_studi, [
    { value: 'A', count: 2, percent: 50 }, { value: 'B', count: 1, percent: 25 }, { value: 'C', count: 1, percent: 25 },
  ]);
  assert.equal(p.distribution.program_studi.reduce((s, x) => s + x.percent, 0), 100);
  assert.equal(p.attributes.program_studi.length, 3, 'top-3 lama tetap ada');
  assert.equal(p.dominant.program_studi, 'A');
});
