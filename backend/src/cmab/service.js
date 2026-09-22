/**
 * Orkestrasi CMAB: rekomendasi template (LinUCB), link ke blast yang benar-benar
 * dipakai, dan poller reward berkala. Semua query difilter per user_id.
 */

const pool = require('../config/database');
const { buildContext, DIMENSION } = require('./context');
const { initModel, selectArm, updateModel } = require('./linucb');
const { computeReward } = require('./reward');

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
     SET blast_id = $1, selected_template_id = $2, linked_at = NOW()
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
        `UPDATE cmab_decisions SET reward=$1, reward_computed_at=NOW() WHERE id=$2`,
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

async function listPerformance(userId) {
  // NUMERIC columns cast to float8 — node-pg returns NUMERIC as a string (to avoid silent
  // precision loss), which breaks plain JS number use (e.g. `.toFixed()`) on the client.
  const { rows } = await pool.query(
    `SELECT m.template_id, t.name AS template_name, m.observation_count,
            m.cumulative_reward::float8 AS cumulative_reward,
            CASE WHEN m.observation_count > 0 THEN (m.cumulative_reward / m.observation_count)::float8 ELSE NULL END AS avg_reward
     FROM cmab_models m
     JOIN templates t ON t.id = m.template_id
     WHERE m.user_id = $1
     ORDER BY avg_reward DESC NULLS LAST, t.name ASC`,
    [userId]
  );
  return rows;
}

async function getLatestDecision(userId) {
  const { rows } = await pool.query(
    `SELECT d.id, d.user_id, d.blast_id, d.recommended_template_id, d.selected_template_id,
            d.context, d.context_vector, d.candidate_scores,
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
};
