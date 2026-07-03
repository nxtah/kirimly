const pool = require('../config/database');

// ── GET /api/templates ──
async function list(req, res) {
  const userId = req.user.user_id;

  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, name, category, body, variables, created_at, updated_at
       FROM templates
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId]
    );

    res.json({ templates: rows });
  } catch (err) {
    console.error('List templates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/templates ──
async function create(req, res) {
  const userId = req.user.user_id;
  const { name, body, category } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Template name is required' });
  }
  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'Template body is required' });
  }

  // Extract variables from {{placeholder}} syntax
  const variableMatches = body.match(/\{\{(\w+)\}\}/g);
  const variables = variableMatches
    ? [...new Set(variableMatches.map((v) => v.replace(/[{}]/g, '')))]
    : [];

  try {
    const { rows } = await pool.query(
      `INSERT INTO templates (user_id, name, body, category, variables)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, name) DO UPDATE
         SET body = EXCLUDED.body,
             category = EXCLUDED.category,
             variables = EXCLUDED.variables,
             updated_at = NOW()
       RETURNING id, user_id, name, category, body, variables, created_at, updated_at`,
      [userId, name.trim(), body.trim(), category || 'general', JSON.stringify(variables)]
    );

    res.status(201).json({ message: 'Template created', template: rows[0] });
  } catch (err) {
    console.error('Create template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PUT /api/templates/:id ──
async function update(req, res) {
  const userId = req.user.user_id;
  const templateId = parseInt(req.params.id, 10);

  if (isNaN(templateId)) {
    return res.status(400).json({ error: 'Invalid template ID' });
  }

  const { name, body, category } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Template name is required' });
  }
  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'Template body is required' });
  }

  const variableMatches = body.match(/\{\{(\w+)\}\}/g);
  const variables = variableMatches
    ? [...new Set(variableMatches.map((v) => v.replace(/[{}]/g, '')))]
    : [];

  try {
    // Ownership check
    const { rows: existing } = await pool.query(
      'SELECT id FROM templates WHERE id = $1 AND user_id = $2',
      [templateId, userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const { rows } = await pool.query(
      `UPDATE templates
       SET name = $1, body = $2, category = $3, variables = $4, updated_at = NOW()
       WHERE id = $5 AND user_id = $6
       RETURNING id, user_id, name, category, body, variables, created_at, updated_at`,
      [name.trim(), body.trim(), category || 'general', JSON.stringify(variables), templateId, userId]
    );

    res.json({ message: 'Template updated', template: rows[0] });
  } catch (err) {
    console.error('Update template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /api/templates/:id ──
async function remove(req, res) {
  const userId = req.user.user_id;
  const templateId = parseInt(req.params.id, 10);

  if (isNaN(templateId)) {
    return res.status(400).json({ error: 'Invalid template ID' });
  }

  try {
    const { rowCount } = await pool.query(
      'DELETE FROM templates WHERE id = $1 AND user_id = $2',
      [templateId, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ message: 'Template deleted' });
  } catch (err) {
    console.error('Delete template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { list, create, update, remove };
