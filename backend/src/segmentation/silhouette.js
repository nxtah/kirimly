/**
 * Silhouette score + saran nilai K. Fungsi murni.
 * Untuk data besar, dihitung pada sampel acak ber-seed (kompleksitas O(n²)).
 */

const { kmeans, mulberry32, sqDist, countDistinct } = require('./kmeans');

const MAX_SAMPLE = 1500;

function sampleIndices(n, maxSample, seed) {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (n <= maxSample) return idx;
  const rand = mulberry32(seed);
  for (let i = n - 1; i > 0; i--) {   // Fisher–Yates
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, maxSample);
}

/** @returns {number|null} rata-rata silhouette (−1..1), null bila tidak terdefinisi */
function silhouetteScore(X, labels, k, { seed = 42, maxSample = MAX_SAMPLE } = {}) {
  const idx = sampleIndices(X.length, maxSample, seed);
  const m = idx.length;

  const nonEmpty = new Set(idx.map((i) => labels[i]));
  if (k < 2 || nonEmpty.size < 2) return null;

  let total = 0;
  for (let a = 0; a < m; a++) {
    const i = idx[a];
    const sumTo = new Float64Array(k);
    const cnt = new Int32Array(k);
    for (let b = 0; b < m; b++) {
      if (a === b) continue;
      const j = idx[b];
      sumTo[labels[j]] += Math.sqrt(sqDist(X[i], X[j]));
      cnt[labels[j]]++;
    }

    const own = labels[i];
    if (cnt[own] === 0) continue; // cluster singleton → s = 0

    const ai = sumTo[own] / cnt[own];
    let bi = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === own || cnt[c] === 0) continue;
      const d = sumTo[c] / cnt[c];
      if (d < bi) bi = d;
    }
    if (!Number.isFinite(bi)) continue;

    const denom = Math.max(ai, bi);
    total += denom === 0 ? 0 : (bi - ai) / denom;
  }
  return total / m;
}

/**
 * Coba K = 2..maxK, hitung silhouette tiap K, rekomendasikan yang tertinggi.
 * @returns {{scores: {k:number, silhouette:number, inertia:number}[], recommended: number|null}}
 */
function suggestK(X, { minK = 2, maxK = 8, seed = 42 } = {}) {
  const n = X.length;
  const distinct = countDistinct(X);
  const upper = Math.min(maxK, n - 1, distinct);

  const scores = [];
  for (let k = minK; k <= upper; k++) {
    try {
      const res = kmeans(X, k, { seed, nInit: 4 });
      const sil = silhouetteScore(X, res.labels, k, { seed });
      if (sil !== null) scores.push({ k, silhouette: sil, inertia: res.inertia });
    } catch {
      // K ini tidak feasible untuk data — lewati
    }
  }

  let recommended = null;
  let bestSil = -Infinity;
  for (const s of scores) {
    if (s.silhouette > bestSil + 1e-9) { bestSil = s.silhouette; recommended = s.k; }
  }
  return { scores, recommended };
}

module.exports = { silhouetteScore, suggestK };
