const pool = require('../config/database');
const waSessionManager = require('../services/waSessionManager');
const { hashPassword } = require('../utils/password');

/* ═══════════════════════════ USERS ═══════════════════════════ */

// ── GET /api/admin/users ──
async function listUsers(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT
         u.id, u.username, u.display_name, u.role, u.is_active, u.created_at, u.updated_at,
         ws.status AS wa_status,
         ws.phone_number,
         ws.last_connected_at,
         (SELECT created_at FROM login_logs WHERE user_id = u.id AND success = true
          ORDER BY created_at DESC LIMIT 1) AS last_login_at,
         (SELECT COUNT(*)::int FROM contacts WHERE user_id = u.id) AS contact_count,
         (SELECT COUNT(*)::int FROM templates WHERE user_id = u.id) AS template_count,
         (SELECT COUNT(*)::int FROM blasts WHERE user_id = u.id) AS blast_count
       FROM users u
       LEFT JOIN wa_sessions ws ON ws.user_id = u.id
       WHERE u.role = 'user'
       ORDER BY u.created_at DESC`
    );

    // Augment with real-time memory status (overrides DB if socket active)
    for (const user of rows) {
      const mem = waSessionManager.sessions.get(user.id);
      if (mem) {
        user.wa_status = mem.status || user.wa_status;
        user.wa_connected = mem.status === 'connected';
      } else {
        user.wa_connected = false;
      }
    }

    res.json({ users: rows });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/users ──
async function createUser(req, res) {
  const { username, password, display_name } = req.body;

  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'Username is required' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Check duplicate
    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE username = $1', [username.trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const hashed = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, display_name, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, username, display_name, role, is_active, created_at`,
      [username.trim(), hashed, display_name?.trim() || null]
    );

    res.status(201).json({ message: 'User created', user: rows[0] });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PUT /api/admin/users/:id ──
async function updateUser(req, res) {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  const { password, is_active, display_name } = req.body;

  // Prevent admin from changing their own account status via this endpoint
  if (userId === req.user.user_id && is_active === false) {
    return res.status(400).json({ error: 'Cannot disable your own account' });
  }

  try {
    // Verify target user exists
    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND role = $2', [userId, 'user']
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const sets = [];
    const params = [];
    let idx = 1;

    if (password !== undefined) {
      const hashed = await hashPassword(password);
      sets.push(`password_hash = $${idx++}`);
      params.push(hashed);
    }
    if (is_active !== undefined) {
      sets.push(`is_active = $${idx++}`);
      params.push(is_active);
    }
    if (display_name !== undefined) {
      sets.push(`display_name = $${idx++}`);
      params.push(display_name?.trim() || null);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(userId);
    sets.push('updated_at = NOW()');

    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx}
       RETURNING id, username, display_name, role, is_active, updated_at`,
      params
    );

    res.json({ message: 'User updated', user: rows[0] });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /api/admin/users/:id ──
async function deleteUser(req, res) {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  if (userId === req.user.user_id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  try {
    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND role = $2', [userId, 'user']
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Terminate WA session  first if active
    await waSessionManager.terminateSession(userId, 'admin_forced');

    // Cascade hard-delete: ON DELETE CASCADE handles contacts, templates, blasts, etc.
    const { rowCount } = await pool.query(
      'DELETE FROM users WHERE id = $1 AND role = $2',
      [userId, 'user']
    );

    res.json({ message: `User deleted (${rowCount} row(s))` });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/* ═══════════════════════════ MONITORING ═══════════════════════════ */

// ── GET /api/admin/monitoring/sessions ──
async function listSessions(_req, res) {
  try {
    // Real-time sessions from memory
    const activeSessions = [];
    for (const [userId, entry] of waSessionManager.sessions) {
      activeSessions.push({
        user_id: userId,
        status: entry.status || 'unknown',
        has_qr: !!entry.qrRaw,
        in_memory: true,
      });
    }

    // Also pull all wa_sessions from DB to catch disconnected users
    const { rows: dbSessions } = await pool.query(
      `SELECT ws.user_id, ws.status, ws.phone_number, ws.last_connected_at, ws.error_message,
              u.username, u.display_name
       FROM wa_sessions ws
       JOIN users u ON u.id = ws.user_id
       ORDER BY ws.updated_at DESC`
    );

    // Merge: memory overrides DB
    const merged = {};
    for (const s of dbSessions) {
      merged[s.user_id] = { ...s, in_memory: false };
    }
    for (const s of activeSessions) {
      merged[s.user_id] = { ...merged[s.user_id] || {}, ...s };
    }

    res.json({ sessions: Object.values(merged) });
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/monitoring/login-logs ──
async function listLoginLogs(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = (page - 1) * limit;
  const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
  const fromDate = req.query.from || null;
  const toDate = req.query.to || null;

  try {
    const conditions = ['true'];
    const params = [];
    let idx = 1;

    if (userId && !isNaN(userId)) {
      conditions.push(`ll.user_id = $${idx++}`);
      params.push(userId);
    }
    if (fromDate) {
      conditions.push(`ll.created_at >= $${idx++}`);
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push(`ll.created_at <= $${idx++}`);
      params.push(toDate + 'T23:59:59Z');
    }

    const where = conditions.join(' AND ');

    const [data, total] = await Promise.all([
      pool.query(
        `SELECT ll.id, ll.user_id, u.username, u.display_name,
                ll.ip_address, ll.user_agent, ll.success, ll.fail_reason,
                ll.logout_at, ll.created_at
         FROM login_logs ll
         JOIN users u ON u.id = ll.user_id
         WHERE ${where}
         ORDER BY ll.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM login_logs ll WHERE ${where}`,
        params
      ),
    ]);

    const totalCount = parseInt(total.rows[0].count, 10);
    res.json({
      logs: data.rows,
      pagination: {
        page,
        limit,
        total: totalCount,
        total_pages: Math.ceil(totalCount / limit),
      },
    });
  } catch (err) {
    console.error('List login logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/monitoring/sessions/:userId/terminate ──
async function terminateSession(req, res) {
  const targetUserId = parseInt(req.params.userId, 10);
  if (isNaN(targetUserId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  // Prevent admin from terminating their own session (admin shouldn't have one)
  if (targetUserId === req.user.user_id) {
    return res.status(400).json({ error: 'Admin accounts do not have WA sessions' });
  }

  try {
    // Check if user exists
    const { rows } = await pool.query(
      'SELECT id, username FROM users WHERE id = $1', [targetUserId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if they have an active session
    const memSession = waSessionManager.sessions.get(targetUserId);
    if (!memSession) {
      return res.status(404).json({ error: 'No active WA session for this user' });
    }

    await waSessionManager.terminateSession(targetUserId, 'admin_forced');

    res.json({
      message: `WA session for ${rows[0].username} (id=${targetUserId}) terminated`,
    });
  } catch (err) {
    console.error('Terminate session error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/* ═══════════════════════════ GLOBAL STATS ═══════════════════════════ */

// ── GET /api/admin/stats ──
async function globalStats(_req, res) {
  try {
    const [
      userCountRes,
      blastCountRes,
      blastMsgCountRes,
      contactCountRes,
      activeSessionsRes,
      recentLoginCountRes,
    ] = await Promise.all([
      pool.query(`SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE is_active = true)::int AS active
        FROM users WHERE role = 'user'`),
      pool.query('SELECT COUNT(*)::int AS total FROM blasts'),
      pool.query(`SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
          COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
          COUNT(*) FILTER (WHERE status = 'read')::int AS read,
          COUNT(*) FILTER (WHERE status = 'replied')::int AS replied,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
        FROM blast_messages`),
      pool.query('SELECT COUNT(*)::int AS total FROM contacts'),
      pool.query(`SELECT COUNT(*)::int AS connected
        FROM wa_sessions WHERE status = 'connected'`),
      pool.query(`SELECT COUNT(*)::int AS last_24h
        FROM login_logs WHERE success = true AND created_at > NOW() - INTERVAL '24 hours'`),
    ]);

    // Real-time connected count from memory (more accurate)
    let memConnected = 0;
    for (const [, entry] of waSessionManager.sessions) {
      if (entry.status === 'connected') memConnected++;
    }

    res.json({
      users: {
        total: userCountRes.rows[0].total,
        active: userCountRes.rows[0].active,
      },
      wa_sessions: {
        connected_db: parseInt(activeSessionsRes.rows[0].connected, 10),
        connected_realtime: memConnected,
      },
      messaging: {
        total_blasts: parseInt(blastCountRes.rows[0].total, 10),
        total_blast_messages: parseInt(blastMsgCountRes.rows[0].total, 10),
        sent: parseInt(blastMsgCountRes.rows[0].sent, 10),
        delivered: parseInt(blastMsgCountRes.rows[0].delivered, 10),
        read: parseInt(blastMsgCountRes.rows[0].read, 10),
        replied: parseInt(blastMsgCountRes.rows[0].replied, 10),
        failed: parseInt(blastMsgCountRes.rows[0].failed, 10),
      },
      contacts: { total: parseInt(contactCountRes.rows[0].total, 10) },
      login_activity: {
        last_24h: parseInt(recentLoginCountRes.rows[0].last_24h, 10),
      },
    });
  } catch (err) {
    console.error('Global stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listUsers, createUser, updateUser, deleteUser,
  listSessions, listLoginLogs, terminateSession,
  globalStats,
};
