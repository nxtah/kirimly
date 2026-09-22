/**
 * Standardisasi format atribut calon mahasiswa.
 * Fungsi murni — tidak menyentuh DB.
 *
 * Tujuan: nilai yang secara makna sama ("sman 1 bandung", "SMA N 1 Bandung.",
 * "SMA Negeri 1 Bandung") menjadi satu kategori yang identik sebelum One-Hot Encoding.
 */

const UNKNOWN = 'Tidak Diketahui';
const MAX_LEN = 100;

const LOWER_WORDS = new Set(['dan', 'di', 'ke', 'dari', 'of', 'the', 'untuk']);
const ACRONYMS = new Set([
  'sma', 'smk', 'smp', 'ma', 'man', 'mas', 'mts', 'sd', 'ipa', 'ips', 'mipa',
  'tkj', 'rpl', 'dki', 'diy', 'ntb', 'ntt', 'pgri', 'ykpi', 'it', 'ti', 'si',
]);

function collapse(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function titleCase(value) {
  return value
    .split(' ')
    .map((word, i) => {
      if (!word) return word;
      if (ACRONYMS.has(word)) return word.toUpperCase();
      if (i > 0 && LOWER_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/** lower-case + buang tanda baca, sisakan huruf/angka/spasi/&/-/. */
function baseClean(value) {
  return collapse(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s&\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function finish(text) {
  const out = titleCase(text).slice(0, MAX_LEN).trim();
  return out || UNKNOWN;
}

/* ───────────── program studi ───────────── */

const PRODI_ALIAS = {
  ti: 'Teknik Informatika',
  'tek informatika': 'Teknik Informatika',
  informatika: 'Teknik Informatika',
  si: 'Sistem Informasi',
  ilkom: 'Ilmu Komputer',
  akuntansi: 'Akuntansi',
  akutansi: 'Akuntansi',
  manajemen: 'Manajemen',
  management: 'Manajemen',
  hukum: 'Ilmu Hukum',
  'ilmu hukum': 'Ilmu Hukum',
  psikologi: 'Psikologi',
  kedokteran: 'Kedokteran',
  farmasi: 'Farmasi',
  'teknik sipil': 'Teknik Sipil',
  'teknik mesin': 'Teknik Mesin',
  'teknik elektro': 'Teknik Elektro',
  'teknik industri': 'Teknik Industri',
  arsitektur: 'Arsitektur',
  'desain komunikasi visual': 'Desain Komunikasi Visual',
  dkv: 'Desain Komunikasi Visual',
  keperawatan: 'Keperawatan',
};

function normalizeProgramStudi(value) {
  let s = baseClean(value);
  if (!s) return UNKNOWN;
  // buang jenjang di depan: "S1 Teknik Informatika", "D3 Akuntansi", "Prodi ..."
  s = s.replace(/^(prodi|program studi|jurusan)\s+/, '').replace(/^(s1|s2|d3|d4|d-3|d-4)\s+/, '');
  if (!s) return UNKNOWN;
  return PRODI_ALIAS[s] || finish(s);
}

/* ───────────── jurusan sekolah ───────────── */

const JURUSAN_ALIAS = [
  [/^(ipa|mipa|ilmu pengetahuan alam|sains|matematika ipa|mia)$/, 'IPA'],
  [/^(ips|ilmu pengetahuan sosial|sosial|iis)$/, 'IPS'],
  [/^(bahasa|ilmu bahasa|bahasa dan budaya)$/, 'Bahasa'],
  [/^(tkj|teknik komputer( dan| &)? jaringan|tjkt|teknik jaringan komputer( dan| &)? telekomunikasi)$/, 'Teknik Komputer dan Jaringan'],
  [/^(rpl|rekayasa perangkat lunak|pplg|pengembangan perangkat lunak( dan| &)? gim)$/, 'Rekayasa Perangkat Lunak'],
  [/^(mm|multimedia|dkv|desain komunikasi visual)$/, 'Multimedia'],
  [/^(akl|akuntansi|akuntansi( dan| &)? keuangan lembaga|ak)$/, 'Akuntansi'],
  [/^(otkp|mpll?|administrasi perkantoran|otomatisasi( dan| &)? tata kelola perkantoran|manajemen perkantoran)$/, 'Administrasi Perkantoran'],
  [/^(bdp|pm|pemasaran|bisnis daring( dan| &)? pemasaran)$/, 'Pemasaran'],
  [/^(tkr|tkro|teknik kendaraan ringan( otomotif)?|otomotif)$/, 'Teknik Kendaraan Ringan'],
  [/^(tsm|teknik( dan)? bisnis sepeda motor)$/, 'Teknik Sepeda Motor'],
  [/^(agama|keagamaan|ilmu agama|ipk)$/, 'Keagamaan'],
];

function normalizeJurusanSekolah(value) {
  const s = baseClean(value);
  if (!s) return UNKNOWN;
  const stripped = s.replace(/^(jurusan|program keahlian|kompetensi keahlian)\s+/, '');
  for (const [re, label] of JURUSAN_ALIAS) {
    if (re.test(stripped)) return label;
  }
  return finish(stripped || s);
}

/* ───────────── asal sekolah ───────────── */

function normalizeAsalSekolah(value) {
  let s = baseClean(value);
  if (!s) return UNKNOWN;

  // "sman1" / "sman 1" / "smkn 2" / "sma n 1" → "sma negeri 1"
  s = s
    .replace(/\b(sma|smk|smp|ma|mts)\s*n\b\s*(?=\d|\p{L})/gu, '$1 negeri ')
    .replace(/\b(sma|smk|smp)n(?=\d|\s|$)/g, '$1 negeri')
    .replace(/\bnegri\b|\bneg\b/g, 'negeri')
    .replace(/\bswt\b|\bswasta\b/g, 'swasta')
    .replace(/\s+/g, ' ')
    .trim();

  // pisahkan angka yang menempel: "sma negeri1" → "sma negeri 1"
  s = s.replace(/(\p{L})(\d)/gu, '$1 $2');

  return finish(s);
}

/* ───────────── domisili ───────────── */

function normalizeDomisili(value) {
  // Ambil bagian pertama sebelum koma: "Kota Bandung, Jawa Barat" → "Kota Bandung"
  const first = collapse(value).split(',').map((p) => p.trim()).find(Boolean);
  let s = baseClean(first || '');
  if (!s) return UNKNOWN;

  s = s
    .replace(/^kota adm(inistrasi)?\s+/, 'kota ')
    .replace(/^(kab|kabupaten)\s+/, 'kabupaten ')
    .replace(/^kt\s+/, 'kota ')
    .replace(/^kota madya\s+/, 'kota ');

  return finish(s);
}

/* ───────────── nama ───────────── */

function normalizeName(value) {
  return collapse(value).slice(0, 150);
}

module.exports = {
  UNKNOWN,
  collapse,
  titleCase,
  normalizeName,
  normalizeProgramStudi,
  normalizeAsalSekolah,
  normalizeJurusanSekolah,
  normalizeDomisili,
};
