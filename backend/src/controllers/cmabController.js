const cmabService = require('../cmab/service');

function handleError(res, err, label) {
  if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
  console.error(`${label} error:`, err);
  res.status(500).json({ error: 'Internal server error' });
}

// ── POST /api/cmab/recommend ──
async function recommend(req, res) {
  const run_id = req.body?.run_id != null ? parseInt(req.body.run_id, 10) : undefined;
  const cluster_no = req.body?.cluster_no != null ? parseInt(req.body.cluster_no, 10) : undefined;

  try {
    const result = await cmabService.getRecommendation(req.user.user_id, { run_id, cluster_no });
    res.json(result);
  } catch (err) {
    handleError(res, err, 'CMAB recommend');
  }
}

// ── GET /api/cmab/performance ──
async function performance(req, res) {
  try {
    res.json({ performance: await cmabService.listPerformance(req.user.user_id) });
  } catch (err) {
    handleError(res, err, 'CMAB performance');
  }
}

// ── GET /api/cmab/decisions/latest ──
async function latestDecision(req, res) {
  try {
    res.json({ decision: await cmabService.getLatestDecision(req.user.user_id) });
  } catch (err) {
    handleError(res, err, 'CMAB latest decision');
  }
}

// ── GET /api/cmab/summary ──
async function summary(req, res) {
  try {
    res.json(await cmabService.getSummary(req.user.user_id));
  } catch (err) {
    handleError(res, err, 'CMAB summary');
  }
}

// ── GET /api/cmab/decisions?page=&limit= ──
async function decisions(req, res) {
  try {
    res.json(await cmabService.listDecisions(req.user.user_id, { page: req.query.page, limit: req.query.limit }));
  } catch (err) {
    handleError(res, err, 'CMAB decisions');
  }
}

// ── GET /api/cmab/reward-timeseries ──
async function rewardTimeseries(req, res) {
  try {
    res.json({ series: await cmabService.getRewardTimeseries(req.user.user_id) });
  } catch (err) {
    handleError(res, err, 'CMAB reward timeseries');
  }
}

// ── GET /api/cmab/evaluation-config ──
// Dokumentasi Evaluation Mode (mapping context vector 19 dim, mekanisme arm/reward sintetis,
// definisi baseline & regret) — tersedia tanpa perlu menjalankan simulasi.
async function evaluationConfig(req, res) {
  try {
    res.json(cmabService.getEvaluationConfig());
  } catch (err) {
    handleError(res, err, 'CMAB evaluation config');
  }
}

// ── POST /api/cmab/evaluate ──
async function evaluate(req, res) {
  const body = req.body || {};
  const params = {
    alpha: body.alpha != null ? parseFloat(body.alpha) : undefined,
    n_contexts: body.n_contexts != null ? parseInt(body.n_contexts, 10) : undefined,
    seed: body.seed != null ? parseInt(body.seed, 10) : undefined,
    n_trials: body.n_trials != null ? parseInt(body.n_trials, 10) : undefined,
  };
  try {
    const result = await cmabService.runEvaluation(req.user.user_id, params);
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err, 'CMAB evaluate');
  }
}

// ── GET /api/cmab/evaluations?page=&limit= ──
async function evaluations(req, res) {
  try {
    res.json(await cmabService.listEvaluations(req.user.user_id, { page: req.query.page, limit: req.query.limit }));
  } catch (err) {
    handleError(res, err, 'CMAB evaluations');
  }
}

// ── GET /api/cmab/evaluations/:id ──
async function evaluationDetail(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid evaluation ID' });
  try {
    const evaluation = await cmabService.getEvaluation(req.user.user_id, id);
    if (!evaluation) return res.status(404).json({ error: 'Evaluation not found' });
    res.json({ evaluation });
  } catch (err) {
    handleError(res, err, 'CMAB evaluation detail');
  }
}

/** Baris CSV per trial + baris ringkasan di akhir, untuk lampiran/audit hasil evaluasi. */
function evaluationToCsv(ev) {
  const lines = ['trial_index,seed,linucb_total,baseline_total,regret'];
  for (const t of ev.trials) lines.push([t.trial_index, t.seed, t.linucb_total, t.baseline_total, t.regret].join(','));
  lines.push('');
  lines.push('metric,linucb,baseline');
  lines.push(`mean_total,${ev.linucb.mean_total},${ev.baseline.mean_total}`);
  lines.push(`std_total,${ev.linucb.std_total},${ev.baseline.std_total}`);
  lines.push(`ci95_low,${ev.linucb.ci95[0]},${ev.baseline.ci95[0]}`);
  lines.push(`ci95_high,${ev.linucb.ci95[1]},${ev.baseline.ci95[1]}`);
  lines.push('');
  lines.push(`improvement_pct,${ev.improvement_pct}`);
  lines.push(`avg_regret,${ev.avg_regret}`);
  lines.push(`std_regret,${ev.std_regret}`);
  lines.push(`alpha,${ev.config.alpha}`);
  lines.push(`n_contexts,${ev.config.n_contexts}`);
  lines.push(`n_trials,${ev.config.n_trials}`);
  lines.push(`seed,${ev.config.seed}`);
  return lines.join('\n');
}

// ── GET /api/cmab/evaluations/:id/export?format=csv|json ──
async function exportEvaluation(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid evaluation ID' });
  const format = req.query.format === 'json' ? 'json' : 'csv';

  try {
    const evaluation = await cmabService.getEvaluation(req.user.user_id, id);
    if (!evaluation) return res.status(404).json({ error: 'Evaluation not found' });

    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="cmab-evaluation-${id}.json"`);
      res.json(evaluation);
    } else {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="cmab-evaluation-${id}.csv"`);
      res.send(evaluationToCsv(evaluation));
    }
  } catch (err) {
    handleError(res, err, 'CMAB evaluation export');
  }
}

module.exports = {
  recommend, performance, latestDecision, summary, decisions, rewardTimeseries,
  evaluationConfig, evaluate, evaluations, evaluationDetail, exportEvaluation,
};
