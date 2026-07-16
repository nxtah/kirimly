const pool = require('../config/database');
const { hashPassword, comparePassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');

// ── POST /api/auth/login ──
async function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const ipAddress = req.ip || req.connection?.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;

  try {
    const { rows } = await pool.query(
      'SELECT id, username, password_hash, display_name, role, is_active FROM users WHERE username = $1',
      [username]
    );

    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!user.is_active) {
      await pool.query(
        `INSERT INTO login_logs (user_id, ip_address, user_agent, success, fail_reason)
         VALUES ($1, $2, $3, false, 'account_disabled')`,
        [user.id, ipAddress, userAgent]
      );
      return res.status(403).json({ error: 'Account is disabled' });
    }

    const valid = await comparePassword(password, user.password_hash);

    if (!valid) {
      await pool.query(
        `INSERT INTO login_logs (user_id, ip_address, user_agent, success, fail_reason)
         VALUES ($1, $2, $3, false, 'invalid_credentials')`,
        [user.id, ipAddress, userAgent]
      );
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Success — generate JWT
    const token = signToken({
      user_id: user.id,
      username: user.username,
      role: user.role,
    });

    // Catat successful login, dapatkan ID log-nya
    const logResult = await pool.query(
      `INSERT INTO login_logs (user_id, ip_address, user_agent, success)
       VALUES ($1, $2, $3, true)
       RETURNING id`,
      [user.id, ipAddress, userAgent]
    );
    const loginLogId = logResult.rows[0].id;

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
      },
      login_log_id: loginLogId,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/auth/logout ──
async function logout(req, res) {
  const userId = req.user.user_id;

  try {
    // Update login_log terakhir user ini yang belum punya logout_at
    const { rowCount } = await pool.query(
      `UPDATE login_logs
       SET logout_at = NOW()
       WHERE id = (
         SELECT id FROM login_logs
         WHERE user_id = $1 AND success = true AND logout_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1
       )`,
      [userId]
    );

    res.json({
      message: rowCount > 0 ? 'Logout recorded' : 'Logged out',
    });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/auth/me ──
async function me(req, res) {
  const { user_id, username, role } = req.user;

  try {
    const { rows } = await pool.query(
      `SELECT id, username, display_name, role, is_active,
              created_at, updated_at
       FROM users
       WHERE id = $1`,
      [user_id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Sertakan info WA session status (null jika belum ada)
    const sessionResult = await pool.query(
      `SELECT status, phone_number, last_connected_at
       FROM wa_sessions
       WHERE user_id = $1`,
      [user_id]
    );

    res.json({
      user: rows[0],
      wa_session: sessionResult.rows[0] || null,
    });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { login, logout, me };
