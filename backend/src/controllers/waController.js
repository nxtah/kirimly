const waSessionManager = require('../services/waSessionManager');

// ── GET /api/wa/session/status ──
async function status(req, res) {
  const userId = req.user.user_id;

  try {
    const info = await waSessionManager.getSessionInfo(userId);

    // Hanya kirim qrDataUri kalau status pending (butuh scan)
    res.json({
      status: info.status,
      phone_number: info.phone_number,
      last_connected_at: info.last_connected_at,
      error_message: info.error_message,
      qr_raw: info.status === 'pending' ? info.qrRaw : null,
      qr_data_uri: info.status === 'pending' ? info.qrDataUri : null,
      credentials_on_disk: info.credentials_on_disk,
    });
  } catch (err) {
    console.error('WA status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/wa/session/start ──
async function start(req, res) {
  const userId = req.user.user_id;

  try {
    // Cek apakah user ini role-nya 'user' (admin tidak boleh punya sesi WA)
    if (req.user.role !== 'user') {
      return res.status(403).json({ error: 'Only users with role "user" can start a WA session' });
    }

    const qr = await waSessionManager.startSession(userId);

    res.json({
      message: qr ? 'Session started, scan QR to connect' : 'Session already connected or pending',
      status: 'pending',
      qr_raw: qr?.qrRaw || null,
      qr_data_uri: qr?.qrDataUri || null,
    });
  } catch (err) {
    console.error('WA start error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/wa/session/logout ──
async function logout(req, res) {
  const userId = req.user.user_id;

  try {
    await waSessionManager.terminateSession(userId, 'user_initiated');
    res.json({ message: 'WhatsApp session disconnected' });
  } catch (err) {
    console.error('WA logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { status, start, logout };
