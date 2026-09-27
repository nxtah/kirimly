/**
 * Orkestrasi CMAB: rekomendasi template (LinUCB), link ke blast yang benar-benar
 * dipakai, dan poller reward berkala. Semua query difilter per user_id.
 */

const pool = require('../config/database');
const { buildContext, DIMENSION } = require('./context');
const { initModel, selectArm, updateModel } = require('./linucb');
const { computeReward } = require('./reward');
const { runEvaluation: computeEvaluation } = require('./evaluate');

const ALPHA = parseFloat(process.env.CMAB_ALPHA) || 0.3;
const REWARD_DELAY_HOURS = parseFloat(process.env.CMAB_REWARD_DELAY_HOURS) || 2;

let _dbDownLogged = false;

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/* ───────────────────────── audience ───────────────────────── */

/**
 * Audience diturunkan dari karakteristik dominan cluster segmentasi (bukan
 * cluster_no mentah, yang berarti berbeda antar run) — kalau blast tidak
 * menyasar sebuah cluster, audience = null ("general" di context.js).
 */
async function resolveAudienceLabel(userId, runId, clusterNo) {
  if (!runId || clusterNo == null) return null;
  const { rows } = await pool.query(
    `SELECT cs.profile
     FROM cluster_segments cs
     JOIN cluster_runs cr ON cr.id = cs.run_id
     WHERE cs.run_id = $1 AND cs.cluster_no = $2 AND cr.user_id = $3`,
    [runId, clusterNo, userId]
  );
  return rows[0]?.profile?.dominant?.program_studi ?? null;
}

/* ───────────────────────── model (arm) ───────────────────────── */

async function getOrInitModel(client, userId, templateId) {
  const { rows } = await client.query(
    `SELECT * FROM cmab_models WHERE user_id=$1 AND template_id=$2`,
    [userId, templateId]
  );
  if (rows[0]) return rows[0];

  const fresh = initModel(DIMENSION);
  const { rows: inserted } = await client.query(
    `INSERT INTO cmab_models (user_id, template_id, dimension, a_matrix, b_vector)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, template_id) DO NOTHING
     RETURNING *`,
    [userId, templateId, DIMENSION, JSON.stringify(fresh.A), JSON.stringify(fresh.b)]
  );
  if (inserted[0]) return inserted[0];

  // Race: request lain barusan insert duluan — ambil yang sudah ada.
  const { rows: existing } = await client.query(
    `SELECT * FROM cmab_models WHERE user_id=$1 AND template_id=$2`,
    [userId, templateId]
  );
  return existing[0];
}

/* ───────────────────────── recommend ───────────────────────── */

/**
 * @param {number} userId
 * @param {{run_id?: number, cluster_no?: number}} params
 */
async function getRecommendation(userId, { run_id, cluster_no } = {}) {
  const now = new Date();
  const audienceLabel = await resolveAudienceLabel(userId, run_id, cluster_no);
  const { vector, label } = buildContext({
    dayOfWeek: now.getDay(),
    hour: now.getHours(),
    audienceLabel,
  });

  const { rows: templates } = await pool.query(
    `SELECT id, name FROM templates WHERE user_id = $1 ORDER BY id ASC`,
    [userId]
  );
  if (templates.length === 0) {
    throw httpError(400, 'Belum ada template — buat template dulu sebelum minta rekomendasi CMAB');
  }

  const models = [];
  for (const t of templates) {
    const row = await getOrInitModel(pool, userId, t.id);
    models.push({ template_id: t.id, model: { dimension: row.dimension, A: row.a_matrix, b: row.b_vector } });
  }

  const { selectedTemplateId, scores } = selectArm(models, vector, ALPHA);

  const { rows: decisionRows } = await pool.query(
    `INSERT INTO cmab_decisions (user_id, recommended_template_id, context, context_vector, candidate_scores)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      userId,
      selectedTemplateId,
      JSON.stringify({ ...label, run_id: run_id ?? null, cluster_no: cluster_no ?? null }),
      JSON.stringify(vector),
      JSON.stringify(scores),
    ]
  );

  return {
    decision_id: decisionRows[0].id,
    recommended_template_id: selectedTemplateId,
    scores,
    context: label,
  };
}

/* ───────────────────────── link ke blast ───────────────────────── */

/**
 * Dipanggil dari blastController setelah blast berhasil dibuat. Dibungkus
 * try/catch di sisi caller — kegagalan di sini tidak boleh menggagalkan
 * pembuatan blast. selectedTemplateId = template yang BENAR-BENAR dipakai
 * (bisa beda dari recommended_template_id kalau user mengganti pilihan).
 */
async function linkDecision(userId, decisionId, blastId, selectedTemplateId) {
  await pool.query(
    `UPDATE cmab_decisions
     SET blast_id = $1, selected_template_id = $2, linked_at = NOW(),
         manual_override = ($2::int IS DISTINCT FROM recommended_template_id)
     WHERE id = $3 AND user_id = $4 AND blast_id IS NULL`,
    [blastId, selectedTemplateId, decisionId, userId]
  );
}

/* ───────────────────────── reward poller ───────────────────────── */

/**
 * Dipanggil berkala (setInterval di index.js, pola sama seperti
 * processScheduledBlasts). Menghitung reward untuk keputusan yang blast-nya
 * sudah 'completed' lebih dari REWARD_DELAY_HOURS yang lalu, lalu memperbarui
 * model LinUCB. Transaksional per-decision agar satu kegagalan tidak
 * menggagalkan yang lain.
 */
async function processDueRewards() {
  let due;
  try {
    ({ rows: due } = await pool.query(
      `SELECT d.id AS decision_id, d.user_id, d.selected_template_id, d.context_vector,
              b.total_contacts, b.delivered_count, b.read_count, b.replied_count
       FROM cmab_decisions d
       JOIN blasts b ON b.id = d.blast_id
       WHERE d.reward_computed_at IS NULL
         AND d.blast_id IS NOT NULL
         AND d.selected_template_id IS NOT NULL
         AND b.status = 'completed'
         AND b.completed_at <= NOW() - ($1 || ' hours')::interval
       LIMIT 50`,
      [REWARD_DELAY_HOURS]
    ));
    _dbDownLogged = false;
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      if (!_dbDownLogged) { console.warn('CMAB reward processor: DB not reachable — skipping'); _dbDownLogged = true; }
      return;
    }
    throw err;
  }

  for (const row of due) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const reward = computeReward(row);
      const contextVector = row.context_vector;

      const { rows: modelRows } = await client.query(
        `SELECT * FROM cmab_models WHERE user_id=$1 AND template_id=$2 FOR UPDATE`,
        [row.user_id, row.selected_template_id]
      );
      const modelRow = modelRows[0] || await getOrInitModel(client, row.user_id, row.selected_template_id);

      const updated = updateModel(
        {
          dimension: modelRow.dimension,
          A: modelRow.a_matrix,
          b: modelRow.b_vector,
          observation_count: modelRow.observation_count,
          cumulative_reward: Number(modelRow.cumulative_reward),
        },
        contextVector,
        reward
      );

      await client.query(
        `UPDATE cmab_models
         SET a_matrix=$1, b_vector=$2, observation_count=$3, cumulative_reward=$4, updated_at=NOW()
         WHERE user_id=$5 AND template_id=$6`,
        [JSON.stringify(updated.A), JSON.stringify(updated.b), updated.observation_count, updated.cumulative_reward,
          row.user_id, row.selected_template_id]
      );
      await client.query(
        `UPDATE cmab_decisions SET reward=$1, reward_computed_at=NOW(), reward_status='computed' WHERE id=$2`,
        [reward, row.decision_id]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`CMAB reward processing error for decision ${row.decision_id}:`, err);
    } finally {
      client.release();
    }
  }
}

/* ───────────────────────── UI queries ───────────────────────── */

/**
 * Performa per arm + breakdown delivered/read/replied/failed (dijumlah dari `blasts` yang
 * benar-benar dipakai arm ini, yaitu blast dengan cmab_decisions.selected_template_id yang
 * cocok — bukan seluruh blast bertemplate itu, supaya angkanya konsisten dengan apa yang
 * dipelajari model) + tingkat override (berapa kali arm ini direkomendasikan tapi diganti).
 */
async function listPerformance(userId) {
  // NUMERIC columns cast to float8 — node-pg returns NUMERIC as a string (to avoid silent
  // precision loss), which breaks plain JS number use (e.g. `.toFixed()`) on the client.
  const { rows } = await pool.query(
    `SELECT m.template_id, t.name AS template_name, m.observation_count,
            m.cumulative_reward::float8 AS cumulative_reward,
            CASE WHEN m.observation_count > 0 THEN (m.cumulative_reward / m.observation_count)::float8 ELSE NULL END AS avg_reward,
            COALESCE(b.total_contacts, 0)::int AS total_contacts,
            COALESCE(b.delivered_count, 0)::int AS delivered_count,
            COALESCE(b.read_count, 0)::int AS read_count,
            COALESCE(b.replied_count, 0)::int AS replied_count,
            COALESCE(b.failed_count, 0)::int AS failed_count,
            COALESCE(rec.recommended_count, 0)::int AS recommended_count,
            COALESCE(rec.override_count, 0)::int AS override_count
     FROM cmab_models m
     JOIN templates t ON t.id = m.template_id
     LEFT JOIN LATERAL (
       SELECT SUM(bl.total_contacts) AS total_contacts, SUM(bl.delivered_count) AS delivered_count,
              SUM(bl.read_count) AS read_count, SUM(bl.replied_count) AS replied_count, SUM(bl.failed_count) AS failed_count
       FROM cmab_decisions d JOIN blasts bl ON bl.id = d.blast_id
       WHERE d.user_id = m.user_id AND d.selected_template_id = m.template_id
     ) b ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS recommended_count,
              COUNT(*) FILTER (WHERE manual_override IS TRUE) AS override_count
       FROM cmab_decisions d WHERE d.user_id = m.user_id AND d.recommended_template_id = m.template_id
     ) rec ON TRUE
     WHERE m.user_id = $1
     ORDER BY avg_reward DESC NULLS LAST, t.name ASC`,
    [userId]
  );
  return rows.map((r) => ({
    ...r,
    override_rate: r.recommended_count > 0 ? r.override_count / r.recommended_count : null,
  }));
}

/** Ringkasan untuk kartu di puncak halaman CMAB — semua dihitung dari DB, tanpa angka statis. */
async function getSummary(userId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM cmab_models WHERE user_id = $1)::int AS arms,
       (SELECT COUNT(*) FROM cmab_decisions WHERE user_id = $1)::int AS decisions,
       (SELECT COALESCE(SUM(observation_count), 0) FROM cmab_models WHERE user_id = $1)::int AS observations,
       (SELECT COUNT(*) FROM cmab_decisions
         WHERE user_id = $1 AND blast_id IS NOT NULL AND reward_status <> 'computed')::int AS pending_rewards`,
    [userId]
  );
  return rows[0];
}

/**
 * Seri cumulative average reward (untuk grafik) dari keputusan yang reward-nya sudah dihitung,
 * diurutkan dari yang paling lama. Dihitung di JS (bukan window function) karena datasetnya kecil
 * per user dan supaya mudah dites.
 */
async function getRewardTimeseries(userId) {
  const { rows } = await pool.query(
    `SELECT d.id AS decision_id, d.reward::float8 AS reward, d.reward_computed_at,
            d.selected_template_id, t.name AS template_name
     FROM cmab_decisions d
     LEFT JOIN templates t ON t.id = d.selected_template_id
     WHERE d.user_id = $1 AND d.reward_computed_at IS NOT NULL
     ORDER BY d.reward_computed_at ASC, d.id ASC`,
    [userId]
  );
  let sum = 0;
  return rows.map((r, i) => {
    sum += r.reward;
    return {
      decision_id: r.decision_id,
      reward: r.reward,
      reward_computed_at: r.reward_computed_at,
      template_name: r.template_name,
      cumulative_avg_reward: sum / (i + 1),
    };
  });
}

/** Riwayat keputusan berpaginasi — semua kolom termasuk status/override, untuk tabel di halaman CMAB. */
async function listDecisions(userId, { page = 1, limit = 20 } = {}) {
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const [data, total] = await Promise.all([
    pool.query(
      `SELECT d.id, d.context, d.recommended_template_id, rt.name AS recommended_template_name,
              d.selected_template_id, st.name AS selected_template_name,
              d.manual_override, d.reward_status, d.reward::float8 AS reward,
              d.decided_at, d.linked_at, d.reward_computed_at
       FROM cmab_decisions d
       LEFT JOIN templates rt ON rt.id = d.recommended_template_id
       LEFT JOIN templates st ON st.id = d.selected_template_id
       WHERE d.user_id = $1
       ORDER BY d.decided_at DESC, d.id DESC
       LIMIT $2 OFFSET $3`,
      [userId, l, (p - 1) * l]
    ),
    pool.query('SELECT COUNT(*)::int AS n FROM cmab_decisions WHERE user_id = $1', [userId]),
  ]);

  const n = total.rows[0].n;
  return { decisions: data.rows, pagination: { page: p, limit: l, total: n, total_pages: Math.ceil(n / l) } };
}

/* ───────────────────────── evaluation mode (simulasi) ───────────────────────── */

/**
 * Jalankan simulasi LinUCB vs baseline statis pada context/arm SINTETIS (evaluate.js) dan
 * simpan hasilnya ke `cmab_simulations` — tabel terpisah, TIDAK PERNAH menulis ke
 * cmab_models/cmab_decisions, supaya data simulasi tidak bisa tercampur ke analytics nyata.
 */
async function runEvaluation(userId, params = {}) {
  const result = computeEvaluation(params);
  const { rows } = await pool.query(
    `INSERT INTO cmab_simulations
       (user_id, n_contexts, seed, arms, linucb_cumulative_reward, baseline_cumulative_reward,
        linucb_total, baseline_total, regret)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, created_at`,
    [
      userId, result.n_contexts, result.seed, JSON.stringify(result.arms),
      JSON.stringify(result.linucb_cumulative_reward), JSON.stringify(result.baseline_cumulative_reward),
      result.linucb_total, result.baseline_total, result.regret,
    ]
  );
  return { id: rows[0].id, created_at: rows[0].created_at, ...result };
}

async function listEvaluations(userId, { page = 1, limit = 10 } = {}) {
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);

  const [data, total] = await Promise.all([
    pool.query(
      `SELECT id, n_contexts, seed, arms, linucb_cumulative_reward, baseline_cumulative_reward,
              linucb_total, baseline_total, regret, created_at
       FROM cmab_simulations WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, l, (p - 1) * l]
    ),
    pool.query('SELECT COUNT(*)::int AS n FROM cmab_simulations WHERE user_id = $1', [userId]),
  ]);

  const n = total.rows[0].n;
  return { evaluations: data.rows, pagination: { page: p, limit: l, total: n, total_pages: Math.ceil(n / l) } };
}

async function getLatestDecision(userId) {
  const { rows } = await pool.query(
    `SELECT d.id, d.user_id, d.blast_id, d.recommended_template_id, d.selected_template_id,
            d.context, d.context_vector, d.candidate_scores, d.manual_override, d.reward_status,
            d.decided_at, d.linked_at, d.reward::float8 AS reward, d.reward_computed_at,
            rt.name AS recommended_template_name, st.name AS selected_template_name
     FROM cmab_decisions d
     LEFT JOIN templates rt ON rt.id = d.recommended_template_id
     LEFT JOIN templates st ON st.id = d.selected_template_id
     WHERE d.user_id = $1
     ORDER BY d.decided_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

module.exports = {
  getRecommendation,
  linkDecision,
  processDueRewards,
  listPerformance,
  getLatestDecision,
  getSummary,
  getRewardTimeseries,
  listDecisions,
  runEvaluation,
  listEvaluations,
};
