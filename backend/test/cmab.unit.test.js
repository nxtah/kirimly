/**
 * Unit test modul CMAB (LinUCB) — matematika murni, tanpa DB.
 * Run: npm test
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { initModel, computeUcbScore, selectArm, updateModel, invert } = require('../src/cmab/linucb');
const { buildContext, DIMENSION, hourBucket, hashToBucket } = require('../src/cmab/context');
const { computeReward } = require('../src/cmab/reward');

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
