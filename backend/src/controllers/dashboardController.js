const pool = require('../config/database');

// ── GET /api/dashboard/stats ──
async function stats(req, res) {
  const userId = req.user.user_id;
  const period = parseInt(req.query.days, 10) || 7;
  const since = new Date(Date.now() - period * 24 * 3600 * 1000).toISOString();

  try {
    const results = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM contacts WHERE user_id = $1', [userId]),
      pool.query('SELECT COUNT(*)::int AS count FROM templates WHERE user_id = $1', [userId]),
      pool.query(
        `SELECT
           COUNT(*)::int                          AS total_blasts,
           COALESCE(SUM(total_contacts), 0)::int  AS total_sent,
           COALESCE(SUM(failed_count), 0)::int    AS total_failed,
           COALESCE(SUM(delivered_count), 0)::int AS total_delivered,
           COALESCE(SUM(read_count), 0)::int      AS total_read,
           COALESCE(SUM(replied_count), 0)::int   AS total_replied
         FROM blasts
         WHERE user_id = $1 AND created_at > $2`,
        [userId, since]
      ),
      pool.query(
        `SELECT id, name, total_contacts, sent_count, failed_count, status, created_at
         FROM blasts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [userId]
      ),
    ]);

    const totalContacts = results[0].rows[0].count;
    const totalTemplates = results[1].rows[0].count;
    const s = results[2].rows[0];
    const recentBlasts = results[3].rows;

    const deliveredRate = s.total_sent > 0
      ? Math.round((s.total_delivered / s.total_sent) * 100) : 0;
    const readRate = s.total_sent > 0
      ? Math.round((s.total_read / s.total_sent) * 100) : 0;

    res.json({
      stats: {
        total_contacts: totalContacts,
        total_templates: totalTemplates,
        period_days: period,
        total_blasts: s.total_blasts,
        messages_sent: s.total_sent,
        messages_delivered: s.total_delivered,
        messages_read: s.total_read,
        messages_replied: s.total_replied,
        messages_failed: s.total_failed,
        delivery_rate: deliveredRate,
        read_rate: readRate,
      },
      recent_blasts: recentBlasts,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { stats };
