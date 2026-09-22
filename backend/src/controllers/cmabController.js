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

module.exports = { recommend, performance, latestDecision };
