/**
 * K-Means Clustering (Lloyd) dengan inisialisasi K-Means++ dan multi-restart.
 * Implementasi murni JavaScript, RNG ber-seed sehingga hasil reproducible.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sqDist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

function countDistinct(X) {
  const seen = new Set();
  for (const row of X) {
    seen.add(row.join(','));
    if (seen.size > 1e6) break;
  }
  return seen.size;
}

function fail(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/** K-Means++: pilih pusat awal dengan peluang ∝ jarak² ke pusat terdekat. */
function initCentroids(X, k, rand) {
  const n = X.length;
  const centroids = [Float64Array.from(X[Math.floor(rand() * n)])];
  const minDist = new Float64Array(n).fill(Infinity);

  while (centroids.length < k) {
    const last = centroids[centroids.length - 1];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = sqDist(X[i], last);
      if (d < minDist[i]) minDist[i] = d;
      total += minDist[i];
    }

    let idx;
    if (total === 0) {
      idx = Math.floor(rand() * n);
    } else {
      let r = rand() * total;
      idx = n - 1;
      for (let i = 0; i < n; i++) {
        r -= minDist[i];
        if (r <= 0) { idx = i; break; }
      }
    }
    centroids.push(Float64Array.from(X[idx]));
  }
  return centroids;
}

function runOnce(X, k, rand, maxIter, tol) {
  const n = X.length;
  const dim = X[0].length;
  let centroids = initCentroids(X, k, rand);
  const labels = new Int32Array(n).fill(-1);
  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;

    // assignment
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = sqDist(X[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (labels[i] !== best) { labels[i] = best; changed++; }
    }

    // update
    const sums = Array.from({ length: k }, () => new Float64Array(dim));
    const sizes = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      const c = labels[i];
      sizes[c]++;
      const row = X[i];
      const sum = sums[c];
      for (let j = 0; j < dim; j++) sum[j] += row[j];
    }

    let shift = 0;
    const next = new Array(k);
    for (let c = 0; c < k; c++) {
      if (sizes[c] === 0) {
        // cluster kosong → pindahkan ke titik yang paling jauh dari pusatnya
        let far = 0;
        let farD = -1;
        for (let i = 0; i < n; i++) {
          const d = sqDist(X[i], centroids[labels[i]]);
          if (d > farD) { farD = d; far = i; }
        }
        next[c] = Float64Array.from(X[far]);
        labels[far] = c;
        changed++;
      } else {
        const m = new Float64Array(dim);
        for (let j = 0; j < dim; j++) m[j] = sums[c][j] / sizes[c];
        next[c] = m;
      }
      shift += sqDist(centroids[c], next[c]);
    }
    centroids = next;

    if (changed === 0 || shift <= tol) break;
  }

  // inertia final
  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += sqDist(X[i], centroids[labels[i]]);
  return { labels, centroids, inertia, iterations };
}

/**
 * @param {Float64Array[]} X matriks fitur (n × d)
 * @param {number} k jumlah cluster
 * @param {{seed?: number, nInit?: number, maxIter?: number, tol?: number}} [opts]
 * @returns {{labels: Int32Array, centroids: Float64Array[], inertia: number, iterations: number, seed: number}}
 */
function kmeans(X, k, opts = {}) {
  const { seed = 42, nInit = 10, maxIter = 100, tol = 1e-8 } = opts;
  const n = X.length;

  if (!Number.isInteger(k) || k < 2) throw fail('Jumlah cluster (K) minimal 2');
  if (n < k) throw fail(`Data (${n}) lebih sedikit dari jumlah cluster (${k})`);
  const distinct = countDistinct(X);
  if (distinct < k) {
    throw fail(`Data terlalu seragam: hanya ${distinct} pola unik, tidak cukup untuk ${k} cluster`);
  }

  let best = null;
  for (let i = 0; i < nInit; i++) {
    const rand = mulberry32(seed + i * 7919);
    const res = runOnce(X, k, rand, maxIter, tol);
    if (!best || res.inertia < best.inertia - 1e-12) best = res;
  }
  return { ...best, seed };
}

module.exports = { kmeans, mulberry32, sqDist, countDistinct };
