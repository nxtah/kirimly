/**
 * Evaluation mode ("Data Simulasi"): bandingkan LinUCB dengan strategi statis
 * (context-blind) pada context DAN arm yang SEPENUHNYA SINTETIS. Fungsi murni,
 * tidak menyentuh DB, tidak memakai template/cmab_models yang sebenarnya —
 * sengaja terisolasi total dari data kampanye nyata (lihat service.js#runEvaluation
 * untuk penyimpanan hasilnya ke tabel terpisah `cmab_simulations`).
 *
 * Memakai ulang mesin LinUCB yang sama (initModel/selectArm/updateModel dari
 * linucb.js) dan builder context yang sama (buildContext/hourBucket/hashToBucket
 * dari context.js) — hanya arm & reward-generatornya yang sintetis, bukan
 * algoritmanya. Sehingga hasil evaluasi benar-benar mencerminkan perilaku
 * LinUCB yang dipakai di produksi.
 */

const { buildContext, DIMENSION, hourBucket, hashToBucket } = require('./context');
const { initModel, selectArm, updateModel } = require('./linucb');

const MIN_CONTEXTS = 100;
const MAX_CONTEXTS = 1000;
const ARM_COUNT = 3;
const ARM_NAMES = ['Simulasi A', 'Simulasi B', 'Simulasi C'];
const AUDIENCE_POOL = ['Teknik Informatika', 'Sistem Informasi', 'Manajemen', 'Desain Komunikasi Visual', 'Ilmu Komunikasi', 'Psikologi'];
const AUDIENCE_BUCKETS = 6; // sama seperti context.js — 6 hash bucket + 1 "general"
const ALPHA = parseFloat(process.env.CMAB_ALPHA) || 0.3;

/** PRNG ber-seed (mulberry32) — deterministik, tanpa dependency, supaya hasil evaluasi reproducible untuk laporan. */
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

/**
 * 3 arm sintetis dengan preferensi tetap (jam & audience favorit berbeda-beda) supaya ada
 * pola yang bisa dipelajari LinUCB dari context — bukan reward acak murni tanpa struktur.
 */
function buildSyntheticArms() {
  return Array.from({ length: ARM_COUNT }, (_, i) => ({
    id: i,
    name: ARM_NAMES[i],
    preferred_hour_bucket: i % 4,                       // 0..3 (lihat context.js#hourBucket)
    preferred_audience_bucket: (i * 2) % (AUDIENCE_BUCKETS + 1), // 0..6 (6 = "general")
    base_rate: 0.2 + i * 0.05,
  }));
}

/** Reward harapan (0..1, tanpa noise) sebuah arm untuk sebuah context — dasar perhitungan regret. */
function expectedReward(arm, hourBucketIdx, audienceBucketIdx) {
  let r = arm.base_rate;
  if (hourBucketIdx === arm.preferred_hour_bucket) r += 0.35;
  if (audienceBucketIdx === arm.preferred_audience_bucket) r += 0.25;
  return clamp01(r);
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

function audienceBucketOf(audienceLabel) {
  return audienceLabel ? hashToBucket(audienceLabel, AUDIENCE_BUCKETS) : AUDIENCE_BUCKETS;
}

/**
 * @param {{n_contexts?: number, seed?: number}} params
 * @returns {object} ringkasan evaluasi (arms, kurva cumulative average reward LinUCB vs baseline, total, regret)
 */
function runEvaluation({ n_contexts = MIN_CONTEXTS, seed = Date.now() } = {}) {
  const nContexts = Math.min(Math.max(parseInt(n_contexts, 10) || MIN_CONTEXTS, MIN_CONTEXTS), MAX_CONTEXTS);
  const arms = buildSyntheticArms();
  const contexts = generateContexts(nContexts, seed);

  // Noise reward LinUCB & baseline diambil dari stream RNG terpisah (seed+1/+2) supaya
  // deterministik tapi tidak saling "membocorkan" hasil satu strategi ke strategi lain.
  const noiseLinucb = mulberry32(seed + 1);
  const noiseBaseline = mulberry32(seed + 2);
  const draw = (rand) => (rand() + rand() - 1) * 0.1; // noise kecil simetris [-0.1, 0.1]

  // LinUCB: satu model per arm sintetis, in-memory saja (tidak menyentuh cmab_models).
  const linucbModels = arms.map((a) => ({ template_id: a.id, model: initModel(DIMENSION) }));

  // Baseline "statis"/context-blind: pilih arm dengan rata-rata reward TERAMATI tertinggi
  // sejauh ini, mengabaikan context sama sekali (kontras langsung dengan LinUCB yang memakai
  // context) — representasi "pilih satu template favorit" tanpa mempertimbangkan kapan/siapa.
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

    // LinUCB memilih pakai context asli (mesin yang sama seperti produksi)
    const { selectedTemplateId: linucbArmId } = selectArm(linucbModels, vector, ALPHA);
    const linucbArm = arms[linucbArmId];
    const linucbReward = clamp01(expectedReward(linucbArm, hb, ab) + draw(noiseLinucb));
    const modelIdx = linucbModels.findIndex((m) => m.template_id === linucbArmId);
    linucbModels[modelIdx] = { template_id: linucbArmId, model: updateModel(linucbModels[modelIdx].model, vector, linucbReward) };

    // Baseline memilih TANPA context — arm belum pernah dicoba dulu (round-robin cold start),
    // baru greedy by observed average.
    let baselineArmId = baselineStats.findIndex((s) => s.count === 0);
    if (baselineArmId === -1) {
      baselineArmId = baselineStats.reduce((best, s, i) => (s.sum / s.count > baselineStats[best].sum / baselineStats[best].count ? i : best), 0);
    }
    const baselineArm = arms[baselineArmId];
    const baselineReward = clamp01(expectedReward(baselineArm, hb, ab) + draw(noiseBaseline));
    baselineStats[baselineArmId].sum += baselineReward;
    baselineStats[baselineArmId].count += 1;

    linucbSum += linucbReward;
    baselineSum += baselineReward;
    regretSum += optimalExpected - expectedReward(linucbArm, hb, ab);

    linucbCurve.push(linucbSum / (step + 1));
    baselineCurve.push(baselineSum / (step + 1));
  }

  return {
    n_contexts: nContexts,
    seed,
    arms: arms.map(({ id, name, preferred_hour_bucket, preferred_audience_bucket, base_rate }) => ({
      id, name, preferred_hour_bucket, preferred_audience_bucket, base_rate,
    })),
    linucb_cumulative_reward: linucbCurve,
    baseline_cumulative_reward: baselineCurve,
    linucb_total: linucbSum,
    baseline_total: baselineSum,
    regret: regretSum,
  };
}

module.exports = { runEvaluation, buildSyntheticArms, generateContexts, expectedReward, MIN_CONTEXTS, MAX_CONTEXTS };
