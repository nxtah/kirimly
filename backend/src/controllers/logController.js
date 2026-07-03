const blastService = require('../services/blastService');

// ── GET /api/logs ──
async function listLogs(req, res) {
  const userId = req.user.user_id;

  try {
    const page = parseInt(req.query.page, 10);
    const limit = parseInt(req.query.limit, 10);
    const result = await blastService.getLogs(userId, {
      page: isNaN(page) ? 1 : page,
      limit: isNaN(limit) ? 50 : limit,
      blast_id: req.query.blast_id ? parseInt(req.query.blast_id, 10) : null,
      status: req.query.status || null,
      search: req.query.search || null,
      from: req.query.from || null,
      to: req.query.to || null,
    });

    res.json(result);
  } catch (err) {
    console.error('List logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { listLogs };
