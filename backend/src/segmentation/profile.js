/**
 * Karakteristik dominan tiap cluster. Fungsi murni.
 * Dihitung dari nilai atribut anggota (bukan dari kategori "Lainnya" hasil penggabungan).
 */

const TOP_N = 3;

/**
 * @param {object[]} members  baris anggota cluster (punya kunci atribut)
 * @param {string[]} attrs
 * @returns {{ size:number, attributes: Record<string, {value:string,count:number,percent:number}[]>, dominant: Record<string,string> }}
 */
function buildProfile(members, attrs) {
  const size = members.length;
  const attributes = {};
  const dominant = {};

  for (const attr of attrs) {
    const counts = new Map();
    for (const m of members) {
      const v = m[attr];
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, TOP_N)
      .map(([value, count]) => ({
        value,
        count,
        percent: size === 0 ? 0 : Math.round((count / size) * 1000) / 10,
      }));
    attributes[attr] = top;
    dominant[attr] = top[0]?.value ?? null;
  }

  return { size, attributes, dominant };
}

module.exports = { buildProfile };
