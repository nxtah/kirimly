/**
 * Kamus normalisasi bawaan untuk 4 variabel clustering.
 * Sengaja berupa data biasa (bukan logika) supaya mudah diaudit & dilampirkan di laporan TA.
 *
 * Format entri: [bentukBaku, [alias...], { ambiguous?: true }]
 *  - alias dibandingkan setelah dibersihkan (huruf kecil, tanpa tanda baca, spasi tunggal)
 *  - ambiguous: singkatan yang bisa berarti lebih dari satu hal → tetap dipetakan, tetapi
 *    diberi status "ambiguous" di laporan preprocessing agar peneliti bisa meninjaunya.
 */

/* ───────────── domisili ───────────── */

const DOMISILI = [
  ['Tangerang Selatan', ['tangsel', 'tang sel', 'kota tangsel', 'tangerang selatan', 'kota tangerang selatan']],
  ['Jakarta Selatan',   ['jaksel', 'jkt selatan', 'jakarta selatan', 'kota jakarta selatan']],
  ['Jakarta Utara',     ['jakut', 'jkt utara', 'jakarta utara', 'kota jakarta utara']],
  ['Jakarta Barat',     ['jakbar', 'jkt barat', 'jakarta barat', 'kota jakarta barat']],
  ['Jakarta Timur',     ['jaktim', 'jkt timur', 'jakarta timur', 'kota jakarta timur']],
  ['Jakarta Pusat',     ['jakpus', 'jkt pusat', 'jakarta pusat', 'kota jakarta pusat']],
  ['Depok',             ['dpk', 'kota depok']],
  ['Cimahi',            ['kota cimahi']],
  ['Yogyakarta',        ['jogja', 'jogjakarta', 'yogya', 'kota yogyakarta', 'kota jogja']],
  ['Surabaya',          ['sby']],
  ['Semarang',          ['smg']],
  ['Makassar',          ['makasar', 'mks']],
  ['Palembang',         ['plg']],
  ['Pekanbaru',         ['pku']],
  // singkatan yang bisa merujuk Kota ATAU Kabupaten → dipetakan, tetapi ditandai ambigu
  ['Kota Bekasi',       ['bks'], { ambiguous: true }],
  ['Kota Bandung',      ['bdg'], { ambiguous: true }],
  ['Kota Tangerang',    ['tng', 'tgr'], { ambiguous: true }],
  ['Kota Bogor',        ['bgr'], { ambiguous: true }],
];

/** Kota yang tidak punya kabupaten kembar → awalan "Kota" dibuang agar "Kota X" = "X". */
const KOTA_ONLY = new Set([
  'tangerang selatan', 'jakarta pusat', 'jakarta utara', 'jakarta barat', 'jakarta selatan',
  'jakarta timur', 'depok', 'cimahi',
]);

/** Nama tempat yang dikenal (dipakai untuk membedakan "canonical" vs "tidak ada di kamus"). */
const DOMISILI_KNOWN = new Set([
  'bandung', 'bogor', 'bekasi', 'tangerang', 'tangerang selatan', 'depok', 'cimahi', 'jakarta pusat',
  'jakarta utara', 'jakarta barat', 'jakarta selatan', 'jakarta timur', 'yogyakarta', 'sleman', 'bantul',
  'surabaya', 'sidoarjo', 'malang', 'semarang', 'solo', 'surakarta', 'medan', 'deli serdang', 'palembang',
  'makassar', 'pekanbaru', 'batam', 'padang', 'denpasar', 'serang', 'cilegon', 'karawang', 'purwakarta',
  'sukabumi', 'cirebon', 'garut', 'tasikmalaya', 'subang', 'sumedang', 'lebak', 'pandeglang', 'lampung',
  'bandar lampung', 'balikpapan', 'samarinda', 'banjarmasin', 'pontianak', 'manado', 'mataram',
]);

/* ───────────── jurusan sekolah ───────────── */

const JURUSAN = [
  ['IPA',   ['ipa', 'mipa', 'ilmu pengetahuan alam', 'sains', 'matematika ipa', 'mia']],
  ['IPS',   ['ips', 'ilmu pengetahuan sosial', 'sosial', 'iis']],
  ['Bahasa', ['bahasa', 'ilmu bahasa', 'bahasa dan budaya']],
  ['Teknik Komputer dan Jaringan', ['tkj', 'teknik komputer dan jaringan', 'teknik komputer jaringan', 'tjkt', 'teknik jaringan komputer dan telekomunikasi']],
  ['Rekayasa Perangkat Lunak', ['rpl', 'rekayasa perangkat lunak', 'pplg', 'pengembangan perangkat lunak dan gim']],
  ['Sistem Informatika Jaringan dan Aplikasi', ['sija', 'sistem informatika jaringan dan aplikasi']],
  ['Multimedia', ['mm', 'multimedia']],
  ['Desain Komunikasi Visual', ['dkv', 'desain komunikasi visual']],
  ['Animasi', ['animasi']],
  ['Akuntansi', ['akl', 'akuntansi', 'akuntansi dan keuangan lembaga']],
  ['Administrasi Perkantoran', ['otkp', 'mpl', 'mplb', 'administrasi perkantoran', 'otomatisasi dan tata kelola perkantoran', 'manajemen perkantoran']],
  ['Pemasaran', ['bdp', 'pm', 'pemasaran', 'bisnis daring dan pemasaran']],
  ['Teknik Kendaraan Ringan', ['tkr', 'tkro', 'teknik kendaraan ringan', 'teknik kendaraan ringan otomotif', 'otomotif']],
  ['Teknik Sepeda Motor', ['tsm', 'tbsm', 'teknik sepeda motor', 'teknik dan bisnis sepeda motor']],
  ['Teknik Instalasi Tenaga Listrik', ['titl', 'teknik instalasi tenaga listrik']],
  ['Teknik Pemesinan', ['tp', 'teknik pemesinan']],
  ['Teknik Otomasi Industri', ['toi', 'teknik otomasi industri']],
  ['Teknik Audio Video', ['tav', 'teknik audio video']],
  ['Desain Pemodelan dan Informasi Bangunan', ['dpib', 'desain pemodelan dan informasi bangunan']],
  ['Perhotelan', ['perhotelan', 'akomodasi perhotelan']],
  ['Tata Boga', ['tata boga', 'kuliner']],
  ['Farmasi', ['farmasi']],
  ['Keperawatan', ['keperawatan', 'asisten keperawatan']],
  ['Keagamaan', ['agama', 'keagamaan', 'ilmu agama', 'ipk']],
];

/* ───────────── program studi ───────────── */

const PRODI = [
  ['Teknik Informatika', ['teknik informatika', 'informatika', 'tek informatika', 'if']],
  ['Teknik Informatika', ['ti'], { ambiguous: true }],           // bisa juga "Teknologi Informasi"
  ['Sistem Informasi',   ['sistem informasi']],
  ['Sistem Informasi',   ['si'], { ambiguous: true }],
  ['Ilmu Komputer',      ['ilmu komputer', 'ilkom']],
  ['Akuntansi',          ['akuntansi', 'akutansi']],
  ['Manajemen',          ['manajemen', 'management']],
  ['Ilmu Hukum',         ['ilmu hukum', 'hukum']],
  ['Psikologi',          ['psikologi']],
  ['Kedokteran',         ['kedokteran']],
  ['Farmasi',            ['farmasi']],
  ['Keperawatan',        ['keperawatan']],
  ['Arsitektur',         ['arsitektur']],
  ['Teknik Sipil',       ['teknik sipil']],
  ['Teknik Mesin',       ['teknik mesin']],
  ['Teknik Elektro',     ['teknik elektro']],
  ['Teknik Industri',    ['teknik industri']],
  ['Desain Komunikasi Visual', ['desain komunikasi visual', 'dkv']],
];

/** Bangun lookup { aliasBersih -> { canonical, ambiguous } } + himpunan bentuk baku. */
function build(entries) {
  const lookup = new Map();
  const canonical = new Set();
  for (const [name, aliases, opts = {}] of entries) {
    canonical.add(name.toLowerCase());
    // Entri non-ambigu tidak boleh ditimpa entri ambigu untuk alias yang sama
    for (const alias of aliases) lookup.set(alias, { canonical: name, ambiguous: !!opts.ambiguous });
    if (!opts.ambiguous) lookup.set(name.toLowerCase(), { canonical: name, ambiguous: false });
  }
  return { lookup, canonical };
}

module.exports = {
  domisili: { ...build(DOMISILI), kotaOnly: KOTA_ONLY, known: DOMISILI_KNOWN },
  jurusan: build(JURUSAN),
  prodi: build(PRODI),
};
