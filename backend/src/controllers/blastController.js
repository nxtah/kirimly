const blastService = require('../services/blastService');

// ── POST /api/blasts ──
async function create(req, res) {
  const userId = req.user.user_id;
  const { template_id, waves, scheduled_at, name } = req.body;

  if (!template_id) {
    return res.status(400).json({ error: 'template_id is required' });
  }
  if (!Array.isArray(waves) || waves.length === 0) {
    return res.status(400).json({ error: 'waves must be a non-empty array of contact ID arrays' });
  }

  try {
    const blast = await blastService.startBlast(userId, template_id, waves, scheduled_at || null, name || null);

    res.status(201).json({
      message: blast.scheduled_at ? 'Blast scheduled' : 'Blast started',
      blast_id: blast.id,
      total_contacts: blast.total_contacts,
      status: blast.status,
      scheduled_at: blast.scheduled_at || null,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('Create blast error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/blasts ──
async function list(req, res) {
  const userId = req.user.user_id;

  try {
    const blasts = await blastService.getBlastsByUser(userId, {
      search: req.query.search || null,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    res.json({ blasts });
  } catch (err) {
    console.error('List blasts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/blasts/:id ──
async function detail(req, res) {
  const userId = req.user.user_id;
  const blastId = parseInt(req.params.id, 10);

  if (isNaN(blastId)) {
    return res.status(400).json({ error: 'Invalid blast ID' });
  }

  try {
    const blast = await blastService.getBlast(blastId, userId);
    if (!blast) {
      return res.status(404).json({ error: 'Blast not found' });
    }

    // Calculate in-flight count
    const pending = blast.total_contacts - blast.sent_count - blast.failed_count;

    res.json({
      blast,
      progress: {
        total: blast.total_contacts,
        sent: blast.sent_count,
        failed: blast.failed_count,
        pending: Math.max(0, pending),
      },
    });
  } catch (err) {
    console.error('Blast detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/blasts/:id/messages ──
async function messages(req, res) {
  const userId = req.user.user_id;
  const blastId = parseInt(req.params.id, 10);

  if (isNaN(blastId)) {
    return res.status(400).json({ error: 'Invalid blast ID' });
  }

  try {
    const result = await blastService.getBlastMessages(blastId, userId);
    if (!result) {
      return res.status(404).json({ error: 'Blast not found' });
    }

    res.json({
      blast: result.blast,
      messages: result.messages,
    });
  } catch (err) {
    console.error('Blast messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/blasts/:id/cancel ──
async function cancel(req, res) {
  const userId = req.user.user_id;
  const blastId = parseInt(req.params.id, 10);

  if (isNaN(blastId)) {
    return res.status(400).json({ error: 'Invalid blast ID' });
  }

  try {
    const result = await blastService.cancelBlast(blastId, userId);
    res.json({ message: 'Blast cancelled', ...result });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('Cancel blast error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { create, list, detail, messages, cancel };
