/**
 * Standardisasi format atribut calon mahasiswa (sebelum One-Hot Encoding).
 * Fungsi murni — tidak menyentuh DB.
 *
 * Tiap normalizer mengembalikan { value, status, original }:
 *   canonical    nilai sudah berupa bentuk baku (hanya spasi/kapitalisasi yang dirapikan)
 *   mapped       diubah lewat kamus/aturan (singkatan → bentuk baku) — dicatat di laporan
 *   ambiguous    dipetakan lewat singkatan yang bisa bermakna ganda — dicatat & ditandai
 *   unrecognized tidak ada di kamus: TIDAK diubah selain spasi & kapitalisasi
 *   missing      kosong → "Tidak Diketahui" (dikeluarkan dari clustering)
 * Sehingga tidak ada perubahan yang terjadi tanpa jejak.
 */

const dict = require('./dictionary');

const UNKNOWN = 'Tidak Diketahui';
const MAX_LEN = 100;

const LOWER_WORDS = new Set(['dan', 'di', 'ke', 'dari', 'of', 'the', 'untuk']);
const ACRONYMS = new Set([
  'sma', 'smk', 'smp', 'ma', 'man', 'mas', 'mts', 'sd', 'ipa', 'ips', 'mipa', 'dki', 'diy', 'ntb', 'ntt', 'pgri', 'ykpi',
]);

function collapse(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Huruf kecil, buang tanda baca, sisakan huruf/angka/spasi/&/-. */
function baseClean(value) {
  return collapse(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s&\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function finish(text) {
  const out = titleCase(text).slice(0, MAX_LEN).trim();
  return out || UNKNOWN;
}

function res(value, status, original) {
  return { value, status, original: collapse(original) };
}

const missing = (original) => res(UNKNOWN, 'missing', original);

/** Bandingkan tanpa memedulikan huruf besar/kecil, tanda baca, dan spasi. */
const sameText = (a, b) => baseClean(a) === baseClean(b);

/**
 * Akronim tak dikenal yang ditulis KAPITAL semua (mis. "SIJA") dipertahankan apa adanya,
 * bukan dirusak jadi "Sija". Hanya dipakai untuk jurusan & prodi (bukan nama tempat).
 */
function keepUnknownAcronym(original, cleaned) {
  const raw = collapse(original);
  if (raw && raw === raw.toUpperCase() && /^[A-Z]{2,6}$/.test(raw) && raw.toLowerCase() === cleaned) return raw;
  return null;
}

/** Status untuk hasil pencarian kamus. */
function dictStatus(original, hit) {
  if (hit.ambiguous) return 'ambiguous';
  return sameText(original, hit.canonical) ? 'canonical' : 'mapped';
}

/* ───────────── program studi ───────────── */

function detailProgramStudi(value) {
  let s = baseClean(value);
  if (!s) return missing(value);
  s = s.replace(/^(prodi|program studi|jurusan)\s+/, '').replace(/^(s1|s2|d3|d4|d-3|d-4)\s+/, '');
  if (!s) return missing(value);

  const hit = dict.prodi.lookup.get(s);
  if (hit) {
    const status = hit.ambiguous ? 'ambiguous' : (sameText(value, hit.canonical) ? 'canonical' : 'mapped');
    return res(hit.canonical, status, value);
  }
  const acr = keepUnknownAcronym(value, s);
  return res(acr || finish(s), 'unrecognized', value);
}

/* ───────────── jurusan sekolah ───────────── */

function detailJurusanSekolah(value) {
  const cleaned = baseClean(value);
  if (!cleaned) return missing(value);
  const s = cleaned.replace(/^(jurusan|program keahlian|kompetensi keahlian)\s+/, '') || cleaned;

  const hit = dict.jurusan.lookup.get(s);
  if (hit) return res(hit.canonical, dictStatus(value, hit), value);

  const acr = keepUnknownAcronym(value, s);
  return res(acr || finish(s), 'unrecognized', value);
}

/* ───────────── asal sekolah ───────────── */

// Alias satu kata dari kamus domisili (non-ambigu), mis. tangsel → "tangerang selatan".
const CITY_TOKEN_ALIASES = new Map();
for (const [alias, hit] of dict.domisili.lookup) {
  if (!alias.includes(' ') && !hit.ambiguous && alias !== hit.canonical.toLowerCase()) {
    CITY_TOKEN_ALIASES.set(alias, hit.canonical.toLowerCase());
  }
}

function detailAsalSekolah(value) {
  let s = baseClean(value);
  if (!s) return missing(value);

  // "sman1" / "sman 1" / "smkn 2" / "sma n 1" → "sma negeri 1"
  const rewritten = s
    .replace(/\b(sma|smk|smp|ma|mts)\s*n\b\s*(?=\d|\p{L})/gu, '$1 negeri ')
    .replace(/\b(sma|smk|smp)n(?=\d|\s|$)/g, '$1 negeri')
    .replace(/\bnegri\b|\bneg\b/g, 'negeri')
    .replace(/\bswt\b|\bswasta\b/g, 'swasta')
    .replace(/\s+/g, ' ')
    .trim()
    // pisahkan angka yang menempel: "sma negeri1" → "sma negeri 1"
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    // singkatan kota yang tidak ambigu di dalam nama sekolah: "sma negeri 1 tangsel" → "... tangerang selatan"
    .split(' ')
    .map((tok) => CITY_TOKEN_ALIASES.get(tok) || tok)
    .join(' ');

  const out = finish(rewritten);
  // Nama sekolah bebas (tidak ada kamus): "mapped" bila singkatan diperluas, selain itu "canonical".
  return res(out, sameText(s, rewritten) ? 'canonical' : 'mapped', value);
}

/* ───────────── domisili ───────────── */

function detailDomisili(value) {
  // Ambil bagian pertama sebelum koma: "Kota Bandung, Jawa Barat" → "Kota Bandung"
  const first = collapse(value).split(',').map((p) => p.trim()).find(Boolean);
  let s = baseClean(first || '');
  if (!s) return missing(value);

  s = s
    .replace(/^kota adm(inistrasi)?\s+/, 'kota ')
    .replace(/^(kab|kabupaten)\s+/, 'kabupaten ')
    .replace(/^kt\s+/, 'kota ')
    .replace(/^kota madya\s+/, 'kota ');

  // 1) alias / singkatan di kamus (Tangsel, Jaksel, Bks, ...)
  const hit = dict.domisili.lookup.get(s);
  if (hit) return res(hit.canonical, dictStatus(value, hit), value);

  // 2) "Kota X" untuk kota tanpa kabupaten kembar → "X"
  const stripped = s.replace(/^kota\s+/, '');
  if (stripped !== s && dict.domisili.kotaOnly.has(stripped)) return res(finish(stripped), 'mapped', value);

  // 3) dikenal / tidak dikenal (Kota/Kabupaten dipertahankan karena bermakna berbeda)
  const known = dict.domisili.known.has(stripped.replace(/^kabupaten\s+/, ''));
  return res(finish(s), known ? 'canonical' : 'unrecognized', value);
}

/* ───────────── nama ───────────── */

function normalizeName(value) {
  return collapse(value).slice(0, 150);
}

/* ───────────── API lama (mengembalikan string) ───────────── */

const str = (fn) => (v) => fn(v).value;

const DETAIL = {
  program_studi: detailProgramStudi,
  asal_sekolah: detailAsalSekolah,
  jurusan_sekolah: detailJurusanSekolah,
  domisili: detailDomisili,
};

module.exports = {
  UNKNOWN,
  collapse,
  titleCase,
  normalizeName,
  DETAIL,
  detailProgramStudi,
  detailAsalSekolah,
  detailJurusanSekolah,
  detailDomisili,
  normalizeProgramStudi: str(detailProgramStudi),
  normalizeAsalSekolah: str(detailAsalSekolah),
  normalizeJurusanSekolah: str(detailJurusanSekolah),
  normalizeDomisili: str(detailDomisili),
};
