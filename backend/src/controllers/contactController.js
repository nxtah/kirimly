const pool = require('../config/database');
const { normalizePhone } = require('../utils/phone');

// ── GET /api/contacts ──
async function list(req, res) {
  const userId = req.user.user_id;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 500);
  const offset = (page - 1) * limit;
  const search = req.query.search ? `%${req.query.search}%` : null;

  try {
    let query, countQuery, params, countParams;

    if (search) {
      query = `SELECT id, user_id, phone_number, name, notes, is_blocked, last_sent_at, created_at, updated_at
               FROM contacts
               WHERE user_id = $1 AND (name ILIKE $2 OR phone_number ILIKE $2)
               ORDER BY created_at DESC LIMIT $3 OFFSET $4`;
      countQuery = `SELECT COUNT(*) FROM contacts WHERE user_id = $1 AND (name ILIKE $2 OR phone_number ILIKE $2)`;
      params = [userId, search, limit, offset];
      countParams = [userId, search];
    } else {
      query = `SELECT id, user_id, phone_number, name, notes, is_blocked, last_sent_at, created_at, updated_at
               FROM contacts WHERE user_id = $1
               ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      countQuery = `SELECT COUNT(*) FROM contacts WHERE user_id = $1`;
      params = [userId, limit, offset];
      countParams = [userId];
    }

    const [data, total] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams),
    ]);

    const totalCount = parseInt(total.rows[0].count, 10);

    res.json({
      contacts: data.rows,
      pagination: {
        page,
        limit,
        total: totalCount,
        total_pages: Math.ceil(totalCount / limit),
      },
    });
  } catch (err) {
    console.error('List contacts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/contacts ──
async function create(req, res) {
  const userId = req.user.user_id;
  const { name, phone_number, notes } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!phone_number) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  const normalized = normalizePhone(phone_number);
  if (!normalized) {
    return res.status(400).json({ error: 'Invalid phone number format (min 10, max 15 digits)' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (user_id, name, phone_number, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, phone_number) DO UPDATE
         SET name = EXCLUDED.name,
             notes = EXCLUDED.notes,
             updated_at = NOW()
       RETURNING id, user_id, name, phone_number, notes, is_blocked, created_at, updated_at`,
      [userId, name.trim(), normalized, notes || null]
    );

    const created = rows[0];
    res.status(201).json({
      message: 'Contact created',
      contact: created,
    });
  } catch (err) {
    console.error('Create contact error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/contacts/import ──
async function importContacts(req, res) {
  const userId = req.user.user_id;
  const { contacts } = req.body;

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'contacts must be a non-empty array of { name, phone_number }' });
  }

  let imported = 0;
  let duplicates = 0;
  let invalid = 0;
  const errors = [];

  for (let i = 0; i < contacts.length; i++) {
    const item = contacts[i];
    const name = item?.name?.trim();
    const rawPhone = item?.phone_number;

    if (!name || !rawPhone) {
      invalid++;
      errors.push({ index: i, name: name || '(empty)', phone: rawPhone || '(empty)', reason: 'name or phone missing' });
      continue;
    }

    const normalized = normalizePhone(rawPhone);
    if (!normalized) {
      invalid++;
      errors.push({ index: i, name, phone: rawPhone, reason: 'invalid phone format' });
      continue;
    }

    try {
      const { rowCount } = await pool.query(
        `INSERT INTO contacts (user_id, name, phone_number)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, phone_number) DO NOTHING`,
        [userId, name, normalized]
      );

      if (rowCount > 0) {
        imported++;
      } else {
        duplicates++;
      }
    } catch (err) {
      invalid++;
      errors.push({ index: i, name, phone: rawPhone, reason: err.message });
    }
  }

  res.status(201).json({
    message: `Import complete: ${imported} imported, ${duplicates} skipped (duplicate), ${invalid} invalid`,
    summary: { total: contacts.length, imported, duplicates, invalid },
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ── PUT /api/contacts/:id ──
async function update(req, res) {
  const userId = req.user.user_id;
  const contactId = parseInt(req.params.id, 10);

  if (isNaN(contactId)) {
    return res.status(400).json({ error: 'Invalid contact ID' });
  }

  const { name, phone_number, notes } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  let normalized;
  if (phone_number) {
    normalized = normalizePhone(phone_number);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
  }

  try {
    // Ownership check
    const { rows: existing } = await pool.query(
      'SELECT id FROM contacts WHERE id = $1 AND user_id = $2',
      [contactId, userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const { rows } = await pool.query(
      `UPDATE contacts
       SET name = $1, phone_number = COALESCE($2, phone_number), notes = $3, updated_at = NOW()
       WHERE id = $4 AND user_id = $5
       RETURNING id, user_id, name, phone_number, notes, is_blocked, last_sent_at, created_at, updated_at`,
      [name.trim(), normalized, notes !== undefined ? notes : null, contactId, userId]
    );

    res.json({ message: 'Contact updated', contact: rows[0] });
  } catch (err) {
    console.error('Update contact error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /api/contacts/:id ──
async function remove(req, res) {
  const userId = req.user.user_id;
  const contactId = parseInt(req.params.id, 10);

  if (isNaN(contactId)) {
    return res.status(400).json({ error: 'Invalid contact ID' });
  }

  try {
    const { rowCount } = await pool.query(
      'DELETE FROM contacts WHERE id = $1 AND user_id = $2',
      [contactId, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ message: 'Contact deleted' });
  } catch (err) {
    console.error('Delete contact error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /api/contacts/bulk ──
async function bulkDelete(req, res) {
  const userId = req.user.user_id;
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array of integers' });
  }

  const contactIds = ids.filter((id) => Number.isInteger(id) || (typeof id === 'string' && /^\d+$/.test(id))).map(Number);
  if (contactIds.length === 0) {
    return res.status(400).json({ error: 'No valid IDs provided' });
  }

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM contacts WHERE id = ANY($1::int[]) AND user_id = $2`,
      [contactIds, userId]
    );

    res.json({ message: `${rowCount} contact(s) deleted`, deleted_count: rowCount });
  } catch (err) {
    console.error('Bulk delete contacts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { list, create, importContacts, update, remove, bulkDelete };
