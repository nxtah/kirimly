/**
 * One-Hot Encoding atribut kategorikal → matriks fitur untuk K-Means.
 * Fungsi murni.
 *
 * - Hanya atribut clustering yang di-encode. Nama & nomor WhatsApp TIDAK ikut.
 * - Kategori langka (di bawah ambang, atau di luar top-N per atribut) digabung ke
 *   "Lainnya" agar atribut berkardinalitas tinggi (mis. asal sekolah) tidak membuat
 *   vektor terlalu jarang (sparse). Penggabungan ini hanya berlaku untuk vektor fitur;
 *   profil cluster tetap memakai nilai aslinya.
 */

const OTHER = 'Lainnya';

function keyOf(value) {
  return String(value).trim().toLowerCase();
}

/**
 * @param {object[]} rows  baris yang sudah dibersihkan
 * @param {string[]} attrs atribut yang dipakai sebagai fitur
 * @param {{maxCategories?: number, minCount?: number}} [opts]
 * @returns {{ matrix: Float64Array[], columns: {attr: string, value: string}[], dim: number }}
 */
function oneHotEncode(rows, attrs, opts = {}) {
  const n = rows.length;
  const maxCategories = opts.maxCategories ?? 25;
  const minCount = opts.minCount ?? (n < 50 ? 1 : Math.max(2, Math.ceil(n * 0.01)));

  const columns = [];            // { attr, value }
  const colIndex = new Map();    // `${attr}\u0000${key}` → kolom

  const plans = attrs.map((attr) => {
    const counts = new Map(); // key → { value, count }
    for (const row of rows) {
      const key = keyOf(row[attr]);
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { value: row[attr], count: 1 });
    }

    const ranked = [...counts.entries()].sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1));
    const kept = ranked.filter(([, e]) => e.count >= minCount).slice(0, maxCategories);
    const keptKeys = new Set(kept.map(([k]) => k));
    const usesOther = ranked.some(([k]) => !keptKeys.has(k));

    for (const [key, entry] of kept) {
      colIndex.set(`${attr}\u0000${key}`, columns.length);
      columns.push({ attr, value: entry.value });
    }
    if (usesOther || kept.length === 0) {
      colIndex.set(`${attr}\u0000${OTHER}`, columns.length);
      columns.push({ attr, value: OTHER });
    }
    return { attr, keptKeys };
  });

  const dim = columns.length;
  const matrix = rows.map((row) => {
    const vec = new Float64Array(dim);
    for (const { attr, keptKeys } of plans) {
      const key = keyOf(row[attr]);
      const col = colIndex.get(`${attr}\u0000${keptKeys.has(key) ? key : OTHER}`);
      vec[col] = 1;
    }
    return vec;
  });

  return { matrix, columns, dim };
}

module.exports = { oneHotEncode, OTHER };
