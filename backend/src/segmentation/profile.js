/**
 * Profil cluster. Fungsi murni.
 * Dihitung dari nilai atribut anggota (bukan dari kategori "Lainnya" hasil penggabungan One-Hot).
 *
 *  - distribution: distribusi PENUH tiap variabel (kategori, jumlah, persentase) — bahan analisis TA
 *  - attributes:   top-3 tiap variabel (dipertahankan untuk kartu ringkas & kompatibilitas)
 *  - dominant:     kategori terbanyak — hanya penanda, BUKAN klaim bahwa seluruh anggota sama
 */

const TOP_N = 3;

const pct = (count, size) => (size === 0 ? 0 : Math.round((count / size) * 1000) / 10);

/**
 * @param {object[]} members  baris anggota cluster (punya kunci atribut)
 * @param {string[]} attrs
 */
function buildProfile(members, attrs) {
  const size = members.length;
  const attributes = {};
  const distribution = {};
  const dominant = {};

  for (const attr of attrs) {
    const counts = new Map();
    for (const m of members) counts.set(m[attr], (counts.get(m[attr]) || 0) + 1);

    const all = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([value, count]) => ({ value, count, percent: pct(count, size) }));

    distribution[attr] = all;
    attributes[attr] = all.slice(0, TOP_N);
    dominant[attr] = all[0]?.value ?? null;
  }

  return { size, attributes, distribution, dominant };
}

module.exports = { buildProfile };
