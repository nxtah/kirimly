/**
 * LinUCB (Li et al., 2010 — "A Contextual-Bandit Approach to Personalized
 * News Article Recommendation") — matematika murni, tanpa I/O, tanpa dependency.
 * Gaya sama seperti backend/src/segmentation/kmeans.js: array polos, tidak
 * ada library aljabar linear (dimensi context di MVP ini kecil, lihat context.js).
 *
 * Per arm (di sini: per template), model menyimpan:
 *   A (d×d) = I + Σ x·xᵀ  atas semua observasi arm ini
 *   b (d)   = Σ reward·x  atas semua observasi arm ini
 * θ = A⁻¹·b adalah estimasi ridge-regression dari bobot reward per fitur context.
 * UCB score = θᵀ·x + α·√(xᵀ·A⁻¹·x)   → dipilih arm dengan skor tertinggi.
 *
 * ── Kenapa cold start (A=I, b=0) aman & tetap memberi kesempatan eksplorasi ──
 * Saat arm belum pernah diamati, A = identitas (setara prior ridge-regression
 * tanpa data) sehingga A⁻¹ = I. Bonus eksplorasi √(xᵀ·A⁻¹·x) = ‖x‖ jadi besar
 * untuk context manapun, karena belum ada bukti (Σx·xᵀ) yang "menyempitkan"
 * ellipsoid kepercayaan pada arah manapun. Begitu arm ini mulai diamati, A
 * mengakumulasi x·xᵀ, sehingga A⁻¹ (dan bonusnya) menyusut pada arah context
 * yang sudah sering dicoba — inilah mekanisme "optimism under uncertainty"
 * yang membuat LinUCB otomatis mencoba arm baru tanpa perlu logika khusus,
 * lalu berangsur condong ke arm dengan θᵀx (mean score) terbaik begitu cukup
 * data terkumpul.
 */

function identity(d) {
  const A = [];
  for (let i = 0; i < d; i++) {
    const row = new Array(d).fill(0);
    row[i] = 1;
    A.push(row);
  }
  return A;
}

function zeros(d) {
  return new Array(d).fill(0);
}

function matVec(M, v) {
  return M.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
}

function outer(x) {
  return x.map((xi) => x.map((xj) => xi * xj));
}

function addMat(A, B) {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

function addVec(a, b) {
  return a.map((v, i) => v + b[i]);
}

function scaleVec(v, s) {
  return v.map((x) => x * s);
}

function dot(a, b) {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

/**
 * Inversi Gauss-Jordan dengan partial pivoting, O(d³). Dimensi context di MVP
 * ini kecil (~19, lihat context.js) dan A selalu simetris positive-definite
 * (identitas + jumlah outer product x·xᵀ yang PSD), jadi metode naive ini
 * stabil secara numerik tanpa perlu library aljabar linear.
 */
function invert(A) {
  const n = A.length;
  // augmented [A | I]
  const M = A.map((row, i) => [...row, ...identity(n)[i]]);

  for (let col = 0; col < n; col++) {
    // partial pivot: cari baris dengan nilai absolut terbesar di kolom ini
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(M[pivotRow][col]) < 1e-12) {
      throw new Error('Matrix is singular — should not happen for I + sum of outer products');
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    const pivot = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= pivot;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= factor * M[col][j];
    }
  }

  return M.map((row) => row.slice(n));
}

/** Cold start: A = identitas, b = nol (lihat penjelasan mekanisme di komentar file). */
function initModel(dimension) {
  return {
    dimension,
    A: identity(dimension),
    b: zeros(dimension),
    observation_count: 0,
    cumulative_reward: 0,
  };
}

function computeUcbScore(model, contextVector, alpha) {
  const Ainv = invert(model.A);
  const theta = matVec(Ainv, model.b);
  const meanScore = dot(theta, contextVector);
  const AinvX = matVec(Ainv, contextVector);
  const explorationBonus = alpha * Math.sqrt(Math.max(0, dot(contextVector, AinvX)));
  return { ucbScore: meanScore + explorationBonus, meanScore, explorationBonus };
}

/**
 * @param {{template_id:number, model:object}[]} models
 * @returns {{selectedTemplateId:number, scores:{template_id:number, ucb_score:number, mean_score:number, exploration_bonus:number}[]}}
 */
function selectArm(models, contextVector, alpha) {
  const scores = models.map(({ template_id, model }) => {
    const s = computeUcbScore(model, contextVector, alpha);
    return { template_id, ucb_score: s.ucbScore, mean_score: s.meanScore, exploration_bonus: s.explorationBonus };
  });
  // Tie-break deterministik: skor sama → arm pertama dalam urutan `models` menang
  // (caller mengurutkan template by id ASC), supaya hasil reproducible untuk laporan.
  const best = scores.reduce((a, b) => (b.ucb_score > a.ucb_score ? b : a));
  return { selectedTemplateId: best.template_id, scores };
}

/** Update immutable-style (kembalikan objek model baru, tidak memutasi input). */
function updateModel(model, contextVector, reward) {
  return {
    dimension: model.dimension,
    A: addMat(model.A, outer(contextVector)),
    b: addVec(model.b, scaleVec(contextVector, reward)),
    observation_count: model.observation_count + 1,
    cumulative_reward: model.cumulative_reward + reward,
  };
}

module.exports = { initModel, computeUcbScore, selectArm, updateModel, invert };
