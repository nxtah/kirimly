const pool = require('../config/database');
const { verifyToken } = require('../utils/jwt');

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = header.split(' ')[1];

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    // Re-check the account on every request so disabled/deleted users lose access immediately
    const { rows } = await pool.query(
      'SELECT username, role, is_active FROM users WHERE id = $1',
      [decoded.user_id]
    );
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is disabled' });
    }

    req.user = {
      user_id: decoded.user_id,
      username: user.username,
      role: user.role,
    };
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = authMiddleware;
