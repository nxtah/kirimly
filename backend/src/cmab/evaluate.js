/**
 * Evaluation mode ("Data Simulasi"): bandingkan LinUCB dengan strategi statis
 * (context-blind) pada context DAN arm yang SEPENUHNYA SINTETIS, diulang beberapa kali
 * (trial) supaya hasilnya punya arti statistik (mean, std dev, CI95) — bukan satu sampel.
 * Fungsi murni, tidak menyentuh DB, tidak memakai template/cmab_models yang sebenarnya —
 * sengaja terisolasi total dari data kampanye nyata (lihat service.js#runEvaluation untuk
 * penyimpanan hasilnya ke tabel terpisah `cmab_simulations`).
 *
 * Memakai ulang mesin LinUCB yang sama (initModel/selectArm/updateModel dari linucb.js),
 * builder context yang sama (buildContext/hourBucket/hashToBucket dari context.js), dan
 * FORMULA REWARD YANG SAMA PERSIS dengan produksi (computeRewardFromRates + WEIGHTS dari
 * reward.js — bukan angka yang ditulis ulang) — sehingga hasil evaluasi benar-benar
 * mencerminkan perilaku LinUCB & rumus reward yang dipakai di produksi.
 *
 * ── Mekanisme reward sintetis (didokumentasikan di sini, dan diekspos lewat
 *    getEvaluationConfig() untuk ditampilkan di halaman CMAB) ──
 * Tiap arm sintetis (Informatif/Persuasif/Urgency) punya "rate dasar" delivered/read/replied
 * plus bonus bila context COCOK dengan preferensinya:
 *   - delivered_rate : hampir konstan (delivery WA didominasi faktor jaringan, bukan konten),
 *                       bonus kecil bila jam pengiriman cocok.
 *   - read_rate      : naik signifikan bila hour_bucket context cocok dengan jam favorit arm
 *                       (orang cenderung membaca WA pada jam kebiasaan tertentu).
 *   - replied_rate   : naik signifikan bila audience context cocok dengan audience favorit arm
 *                       (relevansi pesan terhadap penerima mendorong balasan).
 * Reward SINTETIS per context = computeRewardFromRates({deliveredRate, readRate, repliedRate})
 * — rumus & bobot identik dengan `reward.js#computeReward` yang dipakai untuk blast nyata.
 * Noise kecil ber-seed ditambahkan ke tiap rate supaya tidak deterministik sempurna (mendekati
 * variasi dunia nyata), tapi tetap reproducible untuk seed yang sama.
 */

const { buildContext, DIMENSION, hourBucket, hashToBucket, describeDimensions } = require('./context');
const { initModel, selectArm, updateModel } = require('./linucb');
const { computeRewardFromRates, WEIGHTS } = require('./reward');

const MIN_CONTEXTS = 100;
const MAX_CONTEXTS = 300;
const MIN_TRIALS = 30;
const MAX_TRIALS = 60;
// Batas atas dipilih supaya kasus terberat (MAX_TRIALS × MAX_CONTEXTS) tetap selesai dalam
// puluhan detik pada satu request sinkron (diukur ~1.3ms/context-trial di mesin dev) — tanpa
// perlu background job, sama seperti clustering K-Means yang juga sinkron.
const DEFAULT_ALPHA = parseFloat(process.env.CMAB_ALPHA) || 0.3;
const AUDIENCE_POOL = ['Teknik Informatika', 'Sistem Informasi', 'Manajemen', 'Desain Komunikasi Visual', 'Ilmu Komunikasi', 'Psikologi'];
const AUDIENCE_BUCKETS = 6; // sama seperti context.js — 6 hash bucket + 1 "general"

/**
 * 3 arm sintetis — SEKALI LAGI: label simulasi, TIDAK PERNAH ditulis ke tabel `templates`.
 * Nama & profil terinspirasi gaya pesan WA umum, dipertahankan stabil (dipakai di test).
 *
 * Base rate SENGAJA DIBUAT SAMA PERSIS untuk ketiga arm — supaya yang membedakan performa
 * HANYA bonus saat context cocok (jam & audience favorit). Kalau base rate dibuat berbeda,
 * satu arm bisa "menang telak" di rata-rata TANPA PEDULI context, dan itu juga akan
 * "terlihat" oleh baseline statis (yang memang menghitung rata-rata tanpa context) — sehingga
 * perbandingannya jadi tidak adil/tidak mendemonstrasikan nilai LinUCB. Dengan base rate sama,
 * arm manapun sama baiknya secara rata-rata TANPA context, dan HANYA strategi yang benar-benar
 * memakai context (LinUCB) yang bisa mengungguli baseline secara konsisten.
 */
const BASE_RATE = { delivered: 0.90, read: 0.30, replied: 0.08 };
const SYNTHETIC_ARMS = [
  { id: 0, name: 'Informatif', preferred_hour_bucket: 1, preferred_audience_bucket: 0, base_delivered: BASE_RATE.delivered, base_read: BASE_RATE.read, base_replied: BASE_RATE.replied },
  { id: 1, name: 'Persuasif', preferred_hour_bucket: 2, preferred_audience_bucket: 2, base_delivered: BASE_RATE.delivered, base_read: BASE_RATE.read, base_replied: BASE_RATE.replied },
  { id: 2, name: 'Urgency', preferred_hour_bucket: 3, preferred_audience_bucket: 4, base_delivered: BASE_RATE.delivered, base_read: BASE_RATE.read, base_replied: BASE_RATE.replied },
];

const BASELINE_DEFINITION =
  'Baseline statis (context-blind): setiap langkah memilih arm dengan rata-rata reward TERAMATI ' +
  'tertinggi sejauh ini, mengabaikan context sama sekali (round-robin di awal sampai semua arm ' +
  'tercoba minimal sekali). Merepresentasikan strategi "pilih satu template favorit" tanpa ' +
  'mempertimbangkan kapan/siapa penerimanya — kontras langsung dengan LinUCB yang memakai context.';

const REGRET_FORMULA =
  'regret_t = R*(x_t) − E[R_LinUCB(x_t)], dengan R*(x_t) = maks atas semua arm dari expected reward ' +
  'pada context x_t (tanpa noise), dan E[R_LinUCB(x_t)] = expected reward arm yang DIPILIH LinUCB pada ' +
  'context yang sama (juga tanpa noise, supaya regret mengukur kualitas keputusan, bukan keberuntungan ' +
  'noise). Regret per trial = jumlah regret_t untuk semua context di trial itu; angka yang ditampilkan ' +
  'adalah rata-rata ± std dev regret per trial di seluruh percobaan.';

/** PRNG ber-seed (mulberry32) — deterministik, tanpa dependency, supaya hasil evaluasi reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function mean(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function stdDev(arr, m = mean(arr)) {
  if (arr.length < 2) return 0;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

/** CI95 dengan aproksimasi normal (z=1.96) atas standard error rata-rata — cukup untuk n>=30 (aturan CLT). */
function ci95(arr) {
  const m = mean(arr);
  const sd = stdDev(arr, m);
  const se = sd / Math.sqrt(arr.length);
  return { mean: m, std: sd, low: m - 1.96 * se, high: m + 1.96 * se };
}

/** Expected rates (TANPA noise) — dasar untuk regret (optimal) dan pusat dari draw yang ber-noise. */
function expectedRates(arm, hourBucketIdx, audienceBucketIdx) {
  const hourMatch = hourBucketIdx === arm.preferred_hour_bucket;
  const audienceMatch = audienceBucketIdx === arm.preferred_audience_bucket;
  return {
    deliveredRate: clamp01(arm.base_delivered + (hourMatch ? 0.03 : 0)),
    readRate: clamp01(arm.base_read + (hourMatch ? 0.25 : 0) + (audienceMatch ? 0.05 : 0)),
    repliedRate: clamp01(arm.base_replied + (audienceMatch ? 0.20 : 0) + (hourMatch ? 0.05 : 0)),
  };
}

function expectedReward(arm, hourBucketIdx, audienceBucketIdx) {
  return computeRewardFromRates(expectedRates(arm, hourBucketIdx, audienceBucketIdx));
}

/** Draw realisasi (BER-noise) dari rate dasar arm untuk satu context — dipakai untuk reward yang "diamati". */
function drawRates(arm, hourBucketIdx, audienceBucketIdx, rand) {
  const base = expectedRates(arm, hourBucketIdx, audienceBucketIdx);
  const noise = () => (rand() + rand() - 1) * 0.05; // noise simetris kecil [-0.05, 0.05]
  return {
    deliveredRate: clamp01(base.deliveredRate + noise()),
    readRate: clamp01(base.readRate + noise()),
    repliedRate: clamp01(base.repliedRate + noise()),
  };
}

function audienceBucketOf(audienceLabel) {
  return audienceLabel ? hashToBucket(audienceLabel, AUDIENCE_BUCKETS) : AUDIENCE_BUCKETS;
}

/** Context sintetis: hari/jam acak ber-seed + audience dari pool tetap (kadang "general"). */
function generateContexts(nContexts, seed) {
  const rand = mulberry32(seed);
  const contexts = [];
  for (let i = 0; i < nContexts; i++) {
    const dayOfWeek = Math.floor(rand() * 7);
    const hour = Math.floor(rand() * 24);
    const audienceLabel = rand() < 0.15 ? null : AUDIENCE_POOL[Math.floor(rand() * AUDIENCE_POOL.length)];
    contexts.push({ dayOfWeek, hour, audienceLabel });
  }
  return contexts;
}

function buildSyntheticArms() {
  return SYNTHETIC_ARMS.map((a) => ({ ...a }));
}

/** Satu trial: satu deret context, satu jalur LinUCB vs baseline, dari awal (cold start). */
function runTrial({ nContexts, seed, alpha }) {
  const arms = buildSyntheticArms();
  const contexts = generateContexts(nContexts, seed);

  // Noise reward LinUCB & baseline diambil dari stream RNG terpisah (seed+1/+2) supaya
  // deterministik tapi tidak saling "membocorkan" hasil satu strategi ke strategi lain.
  const noiseLinucb = mulberry32(seed + 1);
  const noiseBaseline = mulberry32(seed + 2);

  const linucbModels = arms.map((a) => ({ template_id: a.id, model: initModel(DIMENSION) }));
  const baselineStats = arms.map(() => ({ sum: 0, count: 0 }));

  let linucbSum = 0;
  let baselineSum = 0;
  let regretSum = 0;
  const linucbCurve = [];
  const baselineCurve = [];

  for (let step = 0; step < contexts.length; step++) {
    const { dayOfWeek, hour, audienceLabel } = contexts[step];
    const { vector } = buildContext({ dayOfWeek, hour, audienceLabel });
    const hb = hourBucket(hour);
    const ab = audienceBucketOf(audienceLabel);

    const optimalExpected = Math.max(...arms.map((a) => expectedReward(a, hb, ab)));

    const { selectedTemplateId: linucbArmId } = selectArm(linucbModels, vector, alpha);
    const linucbArm = arms[linucbArmId];
    const linucbReward = computeRewardFromRates(drawRates(linucbArm, hb, ab, noiseLinucb));
    const modelIdx = linucbModels.findIndex((m) => m.template_id === linucbArmId);
    linucbModels[modelIdx] = { template_id: linucbArmId, model: updateModel(linucbModels[modelIdx].model, vector, linucbReward) };

    let baselineArmId = baselineStats.findIndex((s) => s.count === 0);
    if (baselineArmId === -1) {
      baselineArmId = baselineStats.reduce((best, s, i) => (s.sum / s.count > baselineStats[best].sum / baselineStats[best].count ? i : best), 0);
    }
    const baselineArm = arms[baselineArmId];
    const baselineReward = computeRewardFromRates(drawRates(baselineArm, hb, ab, noiseBaseline));
    baselineStats[baselineArmId].sum += baselineReward;
    baselineStats[baselineArmId].count += 1;

    linucbSum += linucbReward;
    baselineSum += baselineReward;
    regretSum += optimalExpected - expectedReward(linucbArm, hb, ab);

    linucbCurve.push(linucbSum / (step + 1));
    baselineCurve.push(baselineSum / (step + 1));
  }

  return { linucb_total: linucbSum, baseline_total: baselineSum, regret: regretSum, linucb_curve: linucbCurve, baseline_curve: baselineCurve };
}

/** Rata-ratakan beberapa kurva sepanjang sama secara elementwise. */
function averageCurves(curves) {
  const len = curves[0].length;
  const out = new Array(len).fill(0);
  for (const c of curves) for (let i = 0; i < len; i++) out[i] += c[i] / curves.length;
  return out;
}

function rewardFormulaDoc() {
  return {
    production: 'R = 0.2 × delivered_rate + 0.3 × read_rate + 0.5 × replied_rate',
    simulation: 'SAMA PERSIS — memanggil reward.js#computeRewardFromRates dengan bobot yang sama (bukan rumus terpisah).',
    weights: WEIGHTS,
  };
}

/**
 * Dokumentasi konfigurasi Evaluation Mode TANPA menjalankan simulasi apa pun — dipakai halaman
 * CMAB untuk menampilkan mapping context vector, mekanisme arm sintetis, dan rumus (regret,
 * reward, baseline) sebelum pengguna menekan "Jalankan Simulasi".
 */
function getEvaluationConfig() {
  return {
    context_schema: describeDimensions(),
    arms: buildSyntheticArms(),
    reward_formula: rewardFormulaDoc(),
    baseline_definition: BASELINE_DEFINITION,
    regret_formula: REGRET_FORMULA,
    default_alpha: DEFAULT_ALPHA,
    bounds: { min_contexts: MIN_CONTEXTS, max_contexts: MAX_CONTEXTS, min_trials: MIN_TRIALS, max_trials: MAX_TRIALS },
  };
}

/**
 * @param {{alpha?: number, n_contexts?: number, seed?: number, n_trials?: number}} params
 * @returns {object} ringkasan evaluasi multi-trial (arms, statistik LinUCB vs baseline, regret, dsb.)
 */
function runEvaluation({ alpha = DEFAULT_ALPHA, n_contexts = MIN_CONTEXTS, seed = Date.now(), n_trials = MIN_TRIALS } = {}) {
  const a = Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 5) : DEFAULT_ALPHA;
  const nContexts = Math.min(Math.max(parseInt(n_contexts, 10) || MIN_CONTEXTS, MIN_CONTEXTS), MAX_CONTEXTS);
  const nTrials = Math.min(Math.max(parseInt(n_trials, 10) || MIN_TRIALS, MIN_TRIALS), MAX_TRIALS);
  const baseSeed = Number.isFinite(seed) ? Math.trunc(seed) : Date.now();

  const trials = [];
  for (let t = 0; t < nTrials; t++) {
    // Seed per-trial diturunkan dari base seed lewat kelipatan bilangan prima, supaya tiap trial
    // memakai stream RNG yang jelas terpisah tapi tetap 100% reproducible dari (baseSeed, n_trials).
    const trialSeed = (baseSeed + t * 104729) >>> 0;
    const r = runTrial({ nContexts, seed: trialSeed, alpha: a });
    trials.push({ trial_index: t, seed: trialSeed, linucb_total: r.linucb_total, baseline_total: r.baseline_total, regret: r.regret });
    trials[t]._curves = { linucb: r.linucb_curve, baseline: r.baseline_curve }; // dipakai untuk rata-rata kurva, tidak disimpan ke DB
  }

  const linucbTotals = trials.map((t) => t.linucb_total);
  const baselineTotals = trials.map((t) => t.baseline_total);
  const regrets = trials.map((t) => t.regret);

  const linucbStats = ci95(linucbTotals);
  const baselineStats = ci95(baselineTotals);
  const improvementPct = baselineStats.mean !== 0 ? ((linucbStats.mean - baselineStats.mean) / Math.abs(baselineStats.mean)) * 100 : null;

  const linucbCurve = averageCurves(trials.map((t) => t._curves.linucb));
  const baselineCurve = averageCurves(trials.map((t) => t._curves.baseline));
  const trialsOut = trials.map(({ _curves, ...rest }) => rest);

  return {
    config: { alpha: a, n_contexts: nContexts, n_trials: nTrials, seed: baseSeed },
    arms: buildSyntheticArms(),
    context_schema: describeDimensions(),
    reward_formula: rewardFormulaDoc(),
    baseline_definition: BASELINE_DEFINITION,
    regret_formula: REGRET_FORMULA,
    linucb: { mean_total: linucbStats.mean, std_total: linucbStats.std, ci95: [linucbStats.low, linucbStats.high], cumulative_avg_curve: linucbCurve },
    baseline: { mean_total: baselineStats.mean, std_total: baselineStats.std, ci95: [baselineStats.low, baselineStats.high], cumulative_avg_curve: baselineCurve },
    improvement_pct: improvementPct,
    avg_regret: mean(regrets),
    std_regret: stdDev(regrets, mean(regrets)),
    trials: trialsOut,
  };
}

module.exports = {
  runEvaluation, getEvaluationConfig, buildSyntheticArms, generateContexts, expectedReward, expectedRates, drawRates,
  MIN_CONTEXTS, MAX_CONTEXTS, MIN_TRIALS, MAX_TRIALS, BASELINE_DEFINITION, REGRET_FORMULA,
};
