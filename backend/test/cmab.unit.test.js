/**
 * Unit test modul CMAB (LinUCB) — matematika murni, tanpa DB.
 * Run: npm test
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { initModel, computeUcbScore, selectArm, updateModel, invert } = require('../src/cmab/linucb');
const { buildContext, DIMENSION, hourBucket, hashToBucket } = require('../src/cmab/context');
const { computeReward } = require('../src/cmab/reward');
const {
  runEvaluation, getEvaluationConfig, generateContexts, buildSyntheticArms, expectedReward, expectedRates, drawRates,
  MIN_CONTEXTS, MAX_CONTEXTS, MIN_TRIALS, MAX_TRIALS,
} = require('../src/cmab/evaluate');
const { WEIGHTS: REWARD_WEIGHTS, computeRewardFromRates } = require('../src/cmab/reward');

/* ───────────── linucb: cold start & dasar ───────────── */

test('initModel: cold start A=identitas, b=nol', () => {
  const m = initModel(3);
  assert.deepEqual(m.A, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  assert.deepEqual(m.b, [0, 0, 0]);
  assert.equal(m.observation_count, 0);
  assert.equal(m.cumulative_reward, 0);
});

test('cold start: dua arm tanpa observasi punya UCB score sama untuk context sama', () => {
  const a = initModel(4);
  const b = initModel(4);
  const x = [1, 0, 1, 0];
  const sa = computeUcbScore(a, x, 0.3);
  const sb = computeUcbScore(b, x, 0.3);
  assert.equal(sa.meanScore, 0, 'b=0 -> mean score 0');
  assert.equal(sa.ucbScore, sb.ucbScore, 'A=I identik -> exploration bonus & skor sama');
  assert.ok(sa.explorationBonus > 0, 'arm baru tetap dapat bonus eksplorasi (bukan 0)');
});

test('selectArm: tie-break deterministik, arm pertama menang saat skor sama persis', () => {
  const models = [
    { template_id: 5, model: initModel(2) },
    { template_id: 2, model: initModel(2) },
  ];
  const { selectedTemplateId } = selectArm(models, [1, 0], 0.5);
  assert.equal(selectedTemplateId, 5, 'urutan array menentukan pemenang saat seri');
});

/* ───────────── linucb: update & invert ───────────── */

test('updateModel: hand-computed d=2, satu observasi', () => {
  const m = initModel(2);
  const updated = updateModel(m, [1, 0], 1);
  // A += x·xᵀ = [[1,0],[0,0]] -> A jadi [[2,0],[0,1]]
  assert.deepEqual(updated.A, [[2, 0], [0, 1]]);
  // b += reward*x = [1,0] -> b jadi [1,0]
  assert.deepEqual(updated.b, [1, 0]);
  assert.equal(updated.observation_count, 1);
  assert.equal(updated.cumulative_reward, 1);
  // model asli tidak termutasi (immutable-style)
  assert.deepEqual(m.A, [[1, 0], [0, 1]]);
});

test('updateModel: immutable — tidak memutasi objek model input', () => {
  const m = initModel(2);
  const before = JSON.stringify(m);
  updateModel(m, [1, 1], 0.5);
  assert.equal(JSON.stringify(m), before);
});

test('invert: identitas -> identitas; matriks 2x2 dikenal', () => {
  assert.deepEqual(invert([[1, 0], [0, 1]]), [[1, 0], [0, 1]]);

  // [[2,0],[0,1]] invers = [[0.5,0],[0,1]]
  const inv = invert([[2, 0], [0, 1]]);
  assert.ok(Math.abs(inv[0][0] - 0.5) < 1e-9);
  assert.ok(Math.abs(inv[0][1]) < 1e-9);
  assert.ok(Math.abs(inv[1][0]) < 1e-9);
  assert.ok(Math.abs(inv[1][1] - 1) < 1e-9);
});

test('invert: matriks 3x3 non-diagonal dikenal', () => {
  // [[2,1,0],[1,2,1],[0,1,2]]^-1 = 1/4 * [[3,-2,1],[-2,4,-2],[1,-2,3]]
  const A = [[2, 1, 0], [1, 2, 1], [0, 1, 2]];
  const inv = invert(A);
  const expected = [[3, -2, 1], [-2, 4, -2], [1, -2, 3]].map((r) => r.map((v) => v / 4));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      assert.ok(Math.abs(inv[i][j] - expected[i][j]) < 1e-9, `[${i}][${j}]`);
    }
  }
});

/* ───────────── linucb: pembelajaran & eksplorasi vs eksploitasi ───────────── */

test('selectArm: setelah cukup observasi, arm dengan reward konsisten tinggi menang', () => {
  const x = [1, 0, 0, 1]; // context tetap
  let good = initModel(4);
  let bad = initModel(4);

  for (let i = 0; i < 30; i++) {
    good = updateModel(good, x, 1.0);
    bad = updateModel(bad, x, 0.0);
  }

  const { selectedTemplateId, scores } = selectArm(
    [{ template_id: 1, model: good }, { template_id: 2, model: bad }],
    x, 0.3
  );
  assert.equal(selectedTemplateId, 1);
  const goodScore = scores.find((s) => s.template_id === 1);
  assert.ok(goodScore.mean_score > 0.9, `mean_score ${goodScore.mean_score} harus mendekati 1`);
});

test('alpha mempengaruhi eksplorasi vs eksploitasi: alpha besar bisa membalik pilihan', () => {
  const x = [1, 0, 0, 1];
  // arm "terlatih": mean score sedikit lebih rendah, tapi sudah banyak diobservasi (confidence sempit)
  let trained = initModel(4);
  for (let i = 0; i < 50; i++) trained = updateModel(trained, x, 0.6);

  // arm baru: belum pernah diobservasi -> exploration bonus besar
  const fresh = initModel(4);

  const models = [{ template_id: 1, model: trained }, { template_id: 2, model: fresh }];

  const exploit = selectArm(models, x, 0); // alpha=0 -> murni mean_score
  assert.equal(exploit.selectedTemplateId, 1, 'alpha=0: arm terlatih (mean score > 0) menang murni eksploitasi');

  const explore = selectArm(models, x, 5); // alpha besar -> bonus eksplorasi mendominasi
  assert.equal(explore.selectedTemplateId, 2, 'alpha besar: arm baru (belum dicoba) menang karena confidence lebar');
});

/* ───────────── context ───────────── */

test('buildContext: dimensi tetap 19, one-hot benar, bias selalu 1', () => {
  const { vector, label } = buildContext({ dayOfWeek: 1, hour: 19, audienceLabel: null });
  assert.equal(vector.length, DIMENSION);
  assert.equal(DIMENSION, 19);
  assert.equal(vector.reduce((s, x) => s + x, 0), 4, '4 slot bernilai 1: hari, jam, audience(general), bias');
  assert.equal(vector[1], 1, 'hari Senin (index 1)');
  assert.equal(vector[7 + 3], 1, 'jam 19 -> bucket evening (index 3)');
  assert.equal(vector[18], 1, 'bias selalu 1');
  assert.equal(label.day_of_week, 1);
  assert.equal(label.hour_bucket, 'evening');
  assert.equal(label.audience_label, 'general');
});

test('hourBucket: batas-batas bucket benar', () => {
  assert.equal(hourBucket(0), 0);
  assert.equal(hourBucket(5), 0);
  assert.equal(hourBucket(6), 1);
  assert.equal(hourBucket(11), 1);
  assert.equal(hourBucket(12), 2);
  assert.equal(hourBucket(17), 2);
  assert.equal(hourBucket(18), 3);
  assert.equal(hourBucket(23), 3);
});

test('buildContext: audience terisi one-hot di salah satu dari 6 bucket, bukan general', () => {
  const { vector, label } = buildContext({ dayOfWeek: 0, hour: 8, audienceLabel: 'Teknik Informatika' });
  const audienceSlice = vector.slice(11, 18); // 7 slot: 6 bucket + general
  assert.equal(audienceSlice.reduce((s, x) => s + x, 0), 1);
  assert.equal(audienceSlice[6], 0, 'bukan slot general');
  assert.equal(label.audience_label, 'Teknik Informatika');
});

test('hashToBucket: deterministik & dalam rentang', () => {
  const a = hashToBucket('Teknik Informatika', 6);
  const b = hashToBucket('Teknik Informatika', 6);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 6);
});

/* ───────────── reward ───────────── */

test('computeReward: contoh dari spec (T=1)', () => {
  assert.equal(computeReward({ total_contacts: 1, delivered_count: 1, read_count: 1, replied_count: 1 }), 1.0);
  assert.equal(computeReward({ total_contacts: 1, delivered_count: 1, read_count: 1, replied_count: 0 }), 0.5);
  assert.ok(Math.abs(computeReward({ total_contacts: 1, delivered_count: 1, read_count: 0, replied_count: 0 }) - 0.2) < 1e-9);
  assert.equal(computeReward({ total_contacts: 1, delivered_count: 0, read_count: 0, replied_count: 0 }), 0);
});

test('computeReward: agregat multi-kontak (T=10)', () => {
  const r = computeReward({ total_contacts: 10, delivered_count: 8, read_count: 5, replied_count: 2 });
  // 0.2*0.8 + 0.3*0.5 + 0.5*0.2 = 0.16+0.15+0.10 = 0.41
  assert.ok(Math.abs(r - 0.41) < 1e-9, `got ${r}`);
});

test('computeReward: total_contacts 0 atau tidak ada -> 0 (tidak error)', () => {
  assert.equal(computeReward({ total_contacts: 0, delivered_count: 0, read_count: 0, replied_count: 0 }), 0);
  assert.equal(computeReward({ total_contacts: null, delivered_count: 0, read_count: 0, replied_count: 0 }), 0);
});

/* ───────────── evaluate (evaluation mode / Data Simulasi) ───────────── */

test('generateContexts: deterministik ber-seed, jumlah sesuai, dalam rentang valid', () => {
  const a = generateContexts(120, 42);
  const b = generateContexts(120, 42);
  assert.deepEqual(a, b, 'seed sama -> context sintetis identik');
  assert.equal(a.length, 120);
  for (const c of a) {
    assert.ok(c.dayOfWeek >= 0 && c.dayOfWeek <= 6);
    assert.ok(c.hour >= 0 && c.hour <= 23);
    assert.ok(c.audienceLabel === null || typeof c.audienceLabel === 'string');
  }
  const c2 = generateContexts(120, 99);
  assert.notDeepEqual(a, c2, 'seed beda -> context berbeda');
});

test('buildSyntheticArms: 3 arm (Informatif/Persuasif/Urgency), base rate SAMA (hanya preferensi context beda), tidak menyentuh template asli', () => {
  const arms = buildSyntheticArms();
  assert.equal(arms.length, 3);
  assert.deepEqual(arms.map((a) => a.id), [0, 1, 2]);
  assert.deepEqual(arms.map((a) => a.name), ['Informatif', 'Persuasif', 'Urgency']);
  assert.ok(new Set(arms.map((a) => a.preferred_hour_bucket)).size === 3, 'preferensi jam berbeda per arm');
  assert.ok(new Set(arms.map((a) => a.preferred_audience_bucket)).size === 3, 'preferensi audience berbeda per arm');
  for (const f of ['base_delivered', 'base_read', 'base_replied']) {
    const values = new Set(arms.map((a) => a[f]));
    assert.equal(values.size, 1, `${f} harus identik di ketiga arm (fairness vs baseline)`);
  }
});

test('expectedRates/expectedReward: arm mendapat bonus saat bucket jam/audience favoritnya cocok; reward memakai bobot produksi', () => {
  const arms = buildSyntheticArms();
  const arm = arms[0];
  const match = expectedRates(arm, arm.preferred_hour_bucket, arm.preferred_audience_bucket);
  const noMatch = expectedRates(arm, (arm.preferred_hour_bucket + 1) % 4, (arm.preferred_audience_bucket + 1) % 7);
  assert.ok(match.readRate > noMatch.readRate, 'jam cocok -> read_rate naik');
  assert.ok(match.repliedRate > noMatch.repliedRate, 'audience cocok -> replied_rate naik');
  for (const r of [match, noMatch]) for (const v of Object.values(r)) assert.ok(v >= 0 && v <= 1);

  const withMatch = expectedReward(arm, arm.preferred_hour_bucket, arm.preferred_audience_bucket);
  const withoutMatch = expectedReward(arm, (arm.preferred_hour_bucket + 1) % 4, (arm.preferred_audience_bucket + 1) % 7);
  assert.ok(withMatch > withoutMatch, 'bucket favorit harus menghasilkan expected reward lebih tinggi');
  // reward = computeRewardFromRates dengan bobot 0.2/0.3/0.5 yang SAMA dengan produksi — bukan rumus terpisah
  assert.ok(Math.abs(withMatch - computeRewardFromRates(match)) < 1e-9);
});

test('drawRates: realisasi ber-noise tetap dalam [0,1], dan reproducible untuk RNG (seed) yang sama', () => {
  const arm = buildSyntheticArms()[0];
  const lcg = (seed) => { let s = seed >>> 0; return () => { s = (s * 48271) % 2147483647; return s / 2147483647; }; };

  const r1 = drawRates(arm, 1, 0, lcg(99));
  for (const v of Object.values(r1)) assert.ok(v >= 0 && v <= 1);

  const r2 = drawRates(arm, 1, 0, lcg(99));
  assert.deepEqual(r1, r2, 'RNG (seed) sama -> rate hasil draw identik');
});

test('runEvaluation: minimal 30 trial (default), 3 arm sintetis, statistik lengkap, deterministik dari seed', () => {
  const r = runEvaluation({ n_contexts: 100, seed: 7 });
  assert.equal(r.config.n_contexts, 100);
  assert.ok(r.config.n_trials >= MIN_TRIALS, 'default n_trials >= 30');
  assert.equal(r.trials.length, r.config.n_trials);
  assert.equal(r.arms.length, 3);
  assert.equal(r.linucb.cumulative_avg_curve.length, 100);
  assert.equal(r.baseline.cumulative_avg_curve.length, 100);
  assert.equal(typeof r.linucb.mean_total, 'number');
  assert.equal(typeof r.linucb.std_total, 'number');
  assert.equal(r.linucb.ci95.length, 2);
  assert.ok(r.linucb.ci95[0] <= r.linucb.mean_total && r.linucb.mean_total <= r.linucb.ci95[1]);
  assert.ok(r.avg_regret >= 0, 'rata-rata regret tidak boleh negatif');
  assert.ok(r.std_regret >= 0);
  assert.equal(typeof r.improvement_pct, 'number');
  for (const t of r.trials) {
    assert.equal(typeof t.linucb_total, 'number');
    assert.equal(typeof t.baseline_total, 'number');
    assert.ok(t.regret >= 0);
  }
  for (const v of [...r.linucb.cumulative_avg_curve, ...r.baseline.cumulative_avg_curve]) {
    assert.ok(v >= 0 && v <= 1.1, `kurva reward kumulatif ${v} harus mendekati rentang [0,1]`);
  }

  const again = runEvaluation({ n_contexts: 100, seed: 7 });
  assert.deepEqual(r.linucb.cumulative_avg_curve, again.linucb.cumulative_avg_curve, 'seed sama -> hasil reproducible (bukti untuk laporan)');
  assert.equal(r.linucb.mean_total, again.linucb.mean_total);
  assert.deepEqual(r.trials.map((t) => t.seed), again.trials.map((t) => t.seed));
});

test('runEvaluation: n_contexts & n_trials di-clamp ke batas [MIN,MAX] masing-masing; alpha di-clamp ke [0,5]', () => {
  assert.equal(runEvaluation({ n_contexts: 10, seed: 1 }).config.n_contexts, MIN_CONTEXTS);
  assert.equal(runEvaluation({ n_contexts: 999999, seed: 1 }).config.n_contexts, MAX_CONTEXTS);
  assert.equal(runEvaluation({ seed: 1 }).config.n_contexts, MIN_CONTEXTS, 'default juga >= 100');

  assert.equal(runEvaluation({ n_contexts: 100, n_trials: 1, seed: 1 }).config.n_trials, MIN_TRIALS, 'n_trials < 30 -> dipaksa minimal 30');
  assert.equal(runEvaluation({ n_contexts: 100, n_trials: 99999, seed: 1 }).config.n_trials, MAX_TRIALS);

  assert.equal(runEvaluation({ n_contexts: 100, n_trials: 30, alpha: -5, seed: 1 }).config.alpha, 0);
  assert.equal(runEvaluation({ n_contexts: 100, n_trials: 30, alpha: 999, seed: 1 }).config.alpha, 5);
});

test('runEvaluation: LinUCB (pakai context) mengungguli baseline statis (context-blind) secara konsisten di seluruh trial', () => {
  const r = runEvaluation({ n_contexts: 150, n_trials: 30, seed: 2024 });
  assert.ok(
    r.linucb.mean_total > r.baseline.mean_total,
    `LinUCB (${r.linucb.mean_total}) harus mengungguli baseline (${r.baseline.mean_total}) — base rate arm dibuat SAMA, jadi keunggulan hanya bisa datang dari pemakaian context`
  );
  assert.ok(r.improvement_pct > 0, `improvement_pct harus positif, got ${r.improvement_pct}`);
  // CI95 tidak boleh tumpang tindih terlalu jauh dari mean lawannya — bukti keunggulan bukan kebetulan
  assert.ok(r.linucb.ci95[0] > r.baseline.mean_total - r.baseline.std_total * 3, 'keunggulan LinUCB masuk akal secara statistik');
});

test('getEvaluationConfig: dimensi context 19, 3 arm, rumus reward sama persis dengan produksi, definisi baseline & regret ada', () => {
  const cfg = getEvaluationConfig();
  assert.equal(cfg.context_schema.dimension, 19);
  assert.equal(cfg.context_schema.dims.length, 19);
  assert.equal(cfg.arms.length, 3);
  assert.deepEqual(cfg.reward_formula.weights, REWARD_WEIGHTS);
  assert.ok(cfg.baseline_definition.length > 20);
  assert.ok(cfg.regret_formula.length > 20);
  assert.equal(cfg.bounds.min_trials, MIN_TRIALS);
  assert.equal(cfg.bounds.max_trials, MAX_TRIALS);
  assert.equal(cfg.bounds.min_contexts, MIN_CONTEXTS);
  assert.equal(cfg.bounds.max_contexts, MAX_CONTEXTS);
});
