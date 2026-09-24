/**
 * Laporan preprocessing untuk dokumentasi TA. Fungsi murni.
 *  - buildNormalizationReport: agregasi "nilai asli → nilai baku" beserta jumlah & status
 *  - similarValues: pasangan nilai yang MIRIP (kemungkinan typo) — hanya ditandai, TIDAK digabung
 */

const REPORT_LIMIT = 200; // batas baris laporan per atribut agar respons tetap kecil

/**
 * @param {{attr:string, original:string, value:string, status:string}[]} events
 * @returns {Record<string, {
 *   changes: {original:string, value:string, status:string, count:number}[],
 *   unrecognized: {value:string, count:number}[],
 *   totals: Record<string, number>
 * }>}
 */
function buildNormalizationReport(events) {
  const byAttr = {};

  for (const e of events) {
    const a = (byAttr[e.attr] ||= { changes: new Map(), unrecognized: new Map(), totals: {} });
    a.totals[e.status] = (a.totals[e.status] || 0) + 1;

    // "changes": nilai yang benar-benar berubah bentuk (mapped / ambiguous)
    if (e.status === 'mapped' || e.status === 'ambiguous') {
      const key = `${e.original}\u0000${e.value}\u0000${e.status}`;
      const cur = a.changes.get(key) || { original: e.original, value: e.value, status: e.status, count: 0 };
      cur.count++;
      a.changes.set(key, cur);
    }
    // "unrecognized": tidak ada di kamus — dibiarkan apa adanya
    if (e.status === 'unrecognized') {
      a.unrecognized.set(e.value, (a.unrecognized.get(e.value) || 0) + 1);
    }
  }

  const out = {};
  for (const [attr, a] of Object.entries(byAttr)) {
    out[attr] = {
      changes: [...a.changes.values()].sort((x, y) => y.count - x.count).slice(0, REPORT_LIMIT),
      unrecognized: [...a.unrecognized.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((x, y) => y.count - x.count)
        .slice(0, REPORT_LIMIT),
      totals: a.totals,
    };
  }
  return out;
}

/** Gabungkan dua laporan normalisasi (mis. antar-batch import) — jumlah dijumlahkan. */
function mergeReports(a, b) {
  const out = {};
  for (const attr of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = a?.[attr] || { changes: [], unrecognized: [], totals: {} };
    const y = b?.[attr] || { changes: [], unrecognized: [], totals: {} };

    const changes = new Map();
    for (const c of [...x.changes, ...y.changes]) {
      const key = `${c.original}\u0000${c.value}\u0000${c.status}`;
      const cur = changes.get(key);
      changes.set(key, cur ? { ...cur, count: cur.count + c.count } : { ...c });
    }
    const unrecognized = new Map();
    for (const u of [...x.unrecognized, ...y.unrecognized]) unrecognized.set(u.value, (unrecognized.get(u.value) || 0) + u.count);

    const totals = { ...x.totals };
    for (const [s, n] of Object.entries(y.totals)) totals[s] = (totals[s] || 0) + n;

    out[attr] = {
      changes: [...changes.values()].sort((p, q) => q.count - p.count).slice(0, REPORT_LIMIT),
      unrecognized: [...unrecognized.entries()].map(([value, count]) => ({ value, count })).sort((p, q) => q.count - p.count).slice(0, REPORT_LIMIT),
      totals,
    };
  }
  return out;
}

/** Jarak Levenshtein (dua baris memori). */
function levenshtein(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Pasangan kategori yang mirip (jarak ≤ maxDistance) untuk satu atribut.
 * Hanya nilai dengan panjang ≥ 5 yang dibandingkan (hindari kecocokan palsu pada singkatan pendek)
 * dan nilai yang hanya berbeda ANGKA (mis. "SMA Negeri 1" vs "SMA Negeri 2") dilewati —
 * itu sekolah berbeda, bukan typo.
 * @param {Map<string, number>|Record<string, number>} counts nilai → jumlah
 */
function similarValues(counts, maxDistance = 2, limit = 50) {
  const entries = counts instanceof Map ? [...counts.entries()] : Object.entries(counts);
  const items = entries.filter(([v]) => v && v.length >= 5).map(([value, count]) => ({ value, count, key: value.toLowerCase() }));
  const stripDigits = (s) => s.replace(/\d+/g, '#');

  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (stripDigits(a.key) === stripDigits(b.key) && a.key !== b.key) continue; // beda angka saja
      if (levenshtein(a.key, b.key, maxDistance) <= maxDistance) {
        const [x, y] = a.count >= b.count ? [a, b] : [b, a];
        pairs.push({ value: x.value, count: x.count, similar_to: y.value, similar_count: y.count });
      }
    }
  }
  return pairs.sort((p, q) => (q.count + q.similar_count) - (p.count + p.similar_count)).slice(0, limit);
}

module.exports = { buildNormalizationReport, mergeReports, similarValues, levenshtein };
