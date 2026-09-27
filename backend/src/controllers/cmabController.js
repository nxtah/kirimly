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

// ── POST /api/cmab/evaluate ──
async function evaluate(req, res) {
  const n_contexts = req.body?.n_contexts != null ? parseInt(req.body.n_contexts, 10) : undefined;
  try {
    const result = await cmabService.runEvaluation(req.user.user_id, { n_contexts });
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

module.exports = { recommend, performance, latestDecision, summary, decisions, rewardTimeseries, evaluate, evaluations };
