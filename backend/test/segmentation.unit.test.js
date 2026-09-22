/**
 * Unit test modul segmentasi — fungsi murni, tanpa DB.
 * Run: npm test
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const n = require('../src/segmentation/normalize');
const { validateRows, ATTRS } = require('../src/segmentation/validate');
const { oneHotEncode, OTHER } = require('../src/segmentation/oneHot');
const { kmeans } = require('../src/segmentation/kmeans');
const { silhouetteScore, suggestK } = require('../src/segmentation/silhouette');
const { buildProfile } = require('../src/segmentation/profile');

/* ───────────── dataset sintetis: 3 kelompok yang jelas ───────────── */

const GROUPS = [
  { program_studi: 'Teknik Informatika', asal_sekolah: 'SMA Negeri 1 Bandung', jurusan_sekolah: 'IPA', domisili: 'Kota Bandung' },
  { program_studi: 'Manajemen', asal_sekolah: 'SMK Negeri 2 Surabaya', jurusan_sekolah: 'Akuntansi', domisili: 'Kota Surabaya' },
  { program_studi: 'Ilmu Hukum', asal_sekolah: 'SMA Swasta Harapan Medan', jurusan_sekolah: 'IPS', domisili: 'Kota Medan' },
];

function syntheticRows(perGroup = 25) {
  const rows = [];
  const truth = [];
  GROUPS.forEach((g, gi) => {
    for (let i = 0; i < perGroup; i++) {
      const row = { ...g };
      // sedikit noise: tiap baris noise menyimpang di SATU atribut dan pola-nya unik
      // (noise berpasangan identik bisa membuat silhouette lebih suka memecahnya jadi cluster sendiri)
      if (i === 5) row.domisili = 'Kota Jakarta';
      if (i === 11) row.jurusan_sekolah = 'Bahasa';
      if (i === 17) row.program_studi = 'Psikologi';
      rows.push(row);
      truth.push(gi);
    }
  });
  return { rows, truth };
}

/** Setiap cluster hasil harus berisi anggota dari satu kelompok asli saja. */
function purity(labels, truth, k) {
  let correct = 0;
  for (let c = 0; c < k; c++) {
    const counts = {};
    labels.forEach((l, i) => { if (l === c) counts[truth[i]] = (counts[truth[i]] || 0) + 1; });
    correct += Math.max(0, ...Object.values(counts));
  }
  return correct / labels.length;
}

/* ───────────── normalize ───────────── */

test('normalize: asal sekolah — variasi penulisan menjadi satu kategori', () => {
  const variants = ['SMA Negeri 1 Bandung', 'sman 1 bandung', 'SMA N. 1 Bandung', 'SMAN1 Bandung', '  sma  negeri 1   BANDUNG '];
  for (const v of variants) assert.equal(n.normalizeAsalSekolah(v), 'SMA Negeri 1 Bandung', v);
  assert.equal(n.normalizeAsalSekolah('smkn 2 surabaya'), 'SMK Negeri 2 Surabaya');
  // MAN = "MA Negeri": semua penulisan menyatu ke satu kategori
  for (const v of ['MAN 3 Jakarta', 'MA N 3 Jakarta', 'ma negeri 3 jakarta']) {
    assert.equal(n.normalizeAsalSekolah(v), 'MA Negeri 3 Jakarta', v);
  }
});

test('normalize: jurusan sekolah — alias ke label seragam', () => {
  assert.equal(n.normalizeJurusanSekolah('MIPA'), 'IPA');
  assert.equal(n.normalizeJurusanSekolah('ipa'), 'IPA');
  assert.equal(n.normalizeJurusanSekolah('Ilmu Pengetahuan Sosial'), 'IPS');
  assert.equal(n.normalizeJurusanSekolah('TKJ'), 'Teknik Komputer dan Jaringan');
  assert.equal(n.normalizeJurusanSekolah('Jurusan RPL'), 'Rekayasa Perangkat Lunak');
  assert.equal(n.normalizeJurusanSekolah('Tata Boga'), 'Tata Boga');
});

test('normalize: program studi — buang jenjang, alias, title case', () => {
  assert.equal(n.normalizeProgramStudi('S1 Teknik Informatika'), 'Teknik Informatika');
  assert.equal(n.normalizeProgramStudi('teknik   informatika '), 'Teknik Informatika');
  assert.equal(n.normalizeProgramStudi('TI'), 'Teknik Informatika');
  assert.equal(n.normalizeProgramStudi('D3 akuntansi'), 'Akuntansi');
  assert.equal(n.normalizeProgramStudi('sastra inggris'), 'Sastra Inggris');
});

test('normalize: domisili — ambil kota, rapikan prefix Kota/Kabupaten', () => {
  assert.equal(n.normalizeDomisili('Kota Bandung, Jawa Barat'), 'Kota Bandung');
  assert.equal(n.normalizeDomisili('kab. bandung'), 'Kabupaten Bandung');
  assert.equal(n.normalizeDomisili('KABUPATEN Sleman'), 'Kabupaten Sleman');
  assert.equal(n.normalizeDomisili('kota adm. jakarta selatan'), 'Kota Jakarta Selatan');
  assert.equal(n.normalizeDomisili('bandung'), 'Bandung');
});

test('normalize: nilai kosong → Tidak Diketahui', () => {
  for (const fn of [n.normalizeProgramStudi, n.normalizeAsalSekolah, n.normalizeJurusanSekolah, n.normalizeDomisili]) {
    assert.equal(fn(''), n.UNKNOWN);
    assert.equal(fn(null), n.UNKNOWN);
    assert.equal(fn('   '), n.UNKNOWN);
    assert.equal(fn('!!!'), n.UNKNOWN);
  }
});

/* ───────────── validate ───────────── */

test('validate: tolak nama/nomor buruk, tandai duplikat, isi atribut kosong', () => {
  const rows = [
    { name: 'Budi', phone_number: '0812-3456-7001', program_studi: 'ti', asal_sekolah: 'sman 1 bandung', jurusan_sekolah: 'mipa', domisili: 'kota bandung' },
    { name: 'Budi Lagi', phone_number: '+62 812 3456 7001', program_studi: 'x', asal_sekolah: 'y', jurusan_sekolah: 'z', domisili: 'w' }, // nomor sama
    { name: '', phone_number: '081234567002' },                       // tanpa nama
    { name: 'Siti', phone_number: '12' },                             // nomor tidak valid
    { name: 'Dewi', phone_number: 81234567003, program_studi: 'Manajemen' }, // nomor bertipe number, atribut lain kosong
  ];
  const r = validateRows(rows);

  assert.equal(r.valid.length, 2);
  assert.equal(r.invalid.length, 2);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.valid[0].phone_number, '6281234567001');
  assert.equal(r.valid[0].asal_sekolah, 'SMA Negeri 1 Bandung');
  assert.equal(r.valid[0].jurusan_sekolah, 'IPA');
  assert.equal(r.valid[0].name, 'Budi', 'baris pertama dipakai untuk nomor duplikat');

  assert.equal(r.valid[1].asal_sekolah, n.UNKNOWN);
  assert.equal(r.missing.asal_sekolah, 1);
  assert.equal(r.missing.program_studi, 0);
});

/* ───────────── one-hot ───────────── */

test('oneHot: hanya atribut clustering, tiap baris tepat satu "1" per atribut', () => {
  const { rows } = syntheticRows(10);
  const withIdentity = rows.map((r, i) => ({ ...r, name: `Orang ${i}`, phone_number: `62812${i}` }));
  const { matrix, columns, dim } = oneHotEncode(withIdentity, ATTRS);

  assert.equal(matrix.length, rows.length);
  assert.ok(columns.every((c) => ATTRS.includes(c.attr)), 'nama/nomor tidak boleh menjadi fitur');
  assert.ok(!columns.some((c) => /Orang|62812/.test(String(c.value))));
  for (const vec of matrix) {
    assert.equal(vec.length, dim);
    assert.equal(vec.reduce((s, x) => s + x, 0), ATTRS.length);
  }
});

test('oneHot: kategori langka digabung ke "Lainnya"', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ a: 'Umum' });
  for (let i = 0; i < 5; i++) rows.push({ a: `Langka ${i}` });   // masing-masing hanya 1x (< ambang 1% & min 2)
  const { columns } = oneHotEncode(rows, ['a']);

  assert.deepEqual(columns.map((c) => c.value), ['Umum', OTHER]);
});

/* ───────────── kmeans ───────────── */

test('kmeans: memulihkan 3 kelompok yang terpisah jelas', () => {
  const { rows, truth } = syntheticRows();
  const { matrix } = oneHotEncode(rows, ATTRS);
  const res = kmeans(matrix, 3, { seed: 7 });

  assert.equal(new Set(res.labels).size, 3);
  assert.ok(purity(res.labels, truth, 3) >= 0.97, 'cluster harus sesuai kelompok asli');
  assert.ok(res.iterations >= 1 && res.inertia >= 0);
});

test('kmeans: seed sama → hasil sama persis (reproducible)', () => {
  const { rows } = syntheticRows();
  const { matrix } = oneHotEncode(rows, ATTRS);
  const a = kmeans(matrix, 3, { seed: 99 });
  const b = kmeans(matrix, 3, { seed: 99 });
  assert.deepEqual([...a.labels], [...b.labels]);
  assert.equal(a.inertia, b.inertia);
});

test('kmeans: input tidak feasible ditolak dengan pesan jelas (400)', () => {
  const { rows } = syntheticRows(2);
  const { matrix } = oneHotEncode(rows, ATTRS);

  assert.throws(() => kmeans(matrix, 1), (e) => e.statusCode === 400 && /minimal 2/.test(e.message));
  assert.throws(() => kmeans(matrix.slice(0, 2), 3), (e) => e.statusCode === 400 && /lebih sedikit/.test(e.message));

  const same = Array.from({ length: 10 }, () => new Float64Array([1, 0, 1]));
  assert.throws(() => kmeans(same, 2), (e) => e.statusCode === 400 && /seragam/.test(e.message));
});

test('kmeans: tidak ada cluster kosong ketika data unik ≥ K', () => {
  const { rows } = syntheticRows(8);
  const { matrix } = oneHotEncode(rows, ATTRS);
  const res = kmeans(matrix, 5, { seed: 3 });
  const sizes = new Array(5).fill(0);
  for (const l of res.labels) sizes[l]++;
  assert.ok(sizes.every((s) => s > 0), `ukuran cluster: ${sizes}`);
});

/* ───────────── silhouette / suggestK ───────────── */

test('silhouette tinggi untuk cluster yang benar, suggestK merekomendasikan K=3', () => {
  const { rows, truth } = syntheticRows();
  const { matrix } = oneHotEncode(rows, ATTRS);

  const good = silhouetteScore(matrix, Int32Array.from(truth), 3);
  assert.ok(good > 0.5, `silhouette ${good}`);

  const { scores, recommended } = suggestK(matrix, { maxK: 6 });
  assert.equal(recommended, 3);
  assert.ok(scores.length >= 3 && scores.every((s) => s.k >= 2));
});

/* ───────────── profile ───────────── */

test('profile: karakteristik dominan + persentase', () => {
  const members = [
    { program_studi: 'A', domisili: 'X' }, { program_studi: 'A', domisili: 'X' },
    { program_studi: 'A', domisili: 'Y' }, { program_studi: 'B', domisili: 'X' },
  ];
  const p = buildProfile(members, ['program_studi', 'domisili']);

  assert.equal(p.size, 4);
  assert.equal(p.dominant.program_studi, 'A');
  assert.deepEqual(p.attributes.program_studi[0], { value: 'A', count: 3, percent: 75 });
  assert.equal(p.dominant.domisili, 'X');
});
