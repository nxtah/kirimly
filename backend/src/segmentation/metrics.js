/**
 * Metrik evaluasi clustering + rekomendasi K. Fungsi murni.
 *  - daviesBouldin: makin KECIL makin baik
 *  - findElbow:     titik siku kurva K vs SSE
 *  - recommendK:    keputusan dari TIGA metrik (Elbow, Silhouette, Davies-Bouldin), bukan satu
 */

const { sqDist } = require('./kmeans');

/**
 * Davies-Bouldin Index.
 *   S_i  = rata-rata jarak anggota cluster i ke centroid-nya
 *   M_ij = jarak centroid i ke centroid j
 *   DBI  = rata-rata_i [ max_{j≠i} (S_i + S_j) / M_ij ]
 * @returns {number|null} null bila tidak terdefinisi (kurang dari 2 cluster, atau dua centroid berimpit)
 */
function daviesBouldin(X, labels, centroids) {
  const k = centroids.length;
  const sum = new Float64Array(k);
  const cnt = new Int32Array(k);
  for (let i = 0; i < X.length; i++) {
    sum[labels[i]] += Math.sqrt(sqDist(X[i], centroids[labels[i]]));
    cnt[labels[i]]++;
  }

  const active = [];
  for (let c = 0; c < k; c++) if (cnt[c] > 0) active.push(c);
  if (active.length < 2) return null;

  const S = (c) => sum[c] / cnt[c];
  let total = 0;
  for (const i of active) {
    let worst = 0;
    for (const j of active) {
      if (i === j) continue;
      const m = Math.sqrt(sqDist(centroids[i], centroids[j]));
      if (m === 0) return null;
      const r = (S(i) + S(j)) / m;
      if (r > worst) worst = r;
    }
    total += worst;
  }
  return total / active.length;
}

/**
 * Titik siku: K dengan jarak terjauh ke garis lurus yang menghubungkan titik pertama & terakhir
 * (setelah K dan SSE dinormalisasi ke 0..1). Butuh ≥ 3 titik dan SSE yang benar-benar berubah.
 * @returns {{k:number, distances:{k:number, distance:number}[]}|null}
 */
function findElbow(points) {
  if (points.length < 3) return null;
  const ks = points.map((p) => p.k);
  const ys = points.map((p) => p.inertia);
  const kMin = Math.min(...ks), kMax = Math.max(...ks);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (kMax === kMin || yMax === yMin) return null;

  const pts = points.map((p) => ({ k: p.k, x: (p.k - kMin) / (kMax - kMin), y: (p.inertia - yMin) / (yMax - yMin) }));
  const a = pts[0];
  const b = pts[pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);

  const distances = pts.map((p) => ({
    k: p.k,
    distance: Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len,
  }));
  const best = distances.reduce((m, d) => (d.distance > m.distance + 1e-12 ? d : m));
  return { k: best.k, distances };
}

/** Peringkat 1..n per K untuk satu metrik (1 = terbaik). Seri → K lebih kecil dulu. */
function rankBy(rows, score, higherIsBetter) {
  const valid = rows.filter((r) => score(r) != null && Number.isFinite(score(r)));
  const sorted = [...valid].sort((a, b) => {
    const d = higherIsBetter ? score(b) - score(a) : score(a) - score(b);
    return d !== 0 ? d : a.k - b.k;
  });
  const rank = new Map();
  sorted.forEach((r, i) => rank.set(r.k, i + 1));
  return rank;
}

/**
 * Rekomendasi K dari Elbow + Silhouette + Davies-Bouldin.
 * Tiap metrik "memilih" satu K; K dengan suara terbanyak menang. Bila suara imbang / tidak ada
 * kesepakatan, dipakai jumlah peringkat (Borda) dan hasilnya ditandai `needs_user_decision`
 * sehingga pengguna diminta menimbang tabel metrik sendiri.
 *
 * @param {{k:number, inertia:number, silhouette:number|null, davies_bouldin:number|null}[]} rows
 */
function recommendK(rows) {
  if (!rows || rows.length === 0) return null;
  if (rows.length === 1) {
    return { k: rows[0].k, agreement: 'single', needs_user_decision: false, per_metric: {}, votes: {}, rationale: 'Hanya satu kandidat K yang dapat dievaluasi.' };
  }

  const elbow = findElbow(rows);
  const pick = (score, higherIsBetter) => {
    const r = rankBy(rows, score, higherIsBetter);
    const best = [...r.entries()].find(([, rank]) => rank === 1);
    return best ? best[0] : null;
  };

  const per_metric = {
    elbow: elbow ? elbow.k : null,
    silhouette: pick((r) => r.silhouette, true),
    davies_bouldin: pick((r) => r.davies_bouldin, false),
  };

  // suara per K
  const votes = {};
  for (const k of Object.values(per_metric)) if (k != null) votes[k] = (votes[k] || 0) + 1;
  const voters = Object.values(per_metric).filter((k) => k != null).length;
  const maxVotes = Math.max(...Object.values(votes));
  const leaders = Object.keys(votes).map(Number).filter((k) => votes[k] === maxVotes);

  // Borda (jumlah peringkat) untuk pemutus seri
  const ranks = [
    elbow ? new Map([...elbow.distances].sort((a, b) => b.distance - a.distance || a.k - b.k).map((d, i) => [d.k, i + 1])) : null,
    rankBy(rows, (r) => r.silhouette, true),
    rankBy(rows, (r) => r.davies_bouldin, false),
  ].filter(Boolean);
  const borda = (k) => ranks.reduce((s, m) => s + (m.get(k) ?? rows.length), 0);

  const candidates = leaders.length > 1 || maxVotes === 1 ? rows.map((r) => r.k) : leaders;
  const chosen = [...candidates].sort((a, b) => borda(a) - borda(b) || a - b)[0];

  let agreement;
  if (maxVotes === voters && voters >= 2) agreement = 'all';
  else if (maxVotes >= 2) agreement = 'majority';
  else agreement = 'none';

  const label = { elbow: 'Elbow', silhouette: 'Silhouette', davies_bouldin: 'Davies-Bouldin' };
  const detail = Object.entries(per_metric).map(([m, k]) => `${label[m]}: ${k ?? '—'}`).join(', ');
  let rationale;
  if (agreement === 'all') rationale = `Semua metrik yang dapat dihitung sepakat memilih K = ${chosen} (${detail}).`;
  else if (agreement === 'majority') rationale = `Mayoritas metrik memilih K = ${chosen} (${detail}).`;
  else rationale = `Metrik tidak sepakat (${detail}). K = ${chosen} hanya usulan berdasarkan jumlah peringkat; sebaiknya pilih K dengan menimbang tabel metrik dan tujuan segmentasi.`;

  return { k: chosen, agreement, needs_user_decision: agreement === 'none', per_metric, votes, rationale };
}

module.exports = { daviesBouldin, findElbow, recommendK };
