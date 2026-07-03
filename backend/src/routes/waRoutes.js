const { Router } = require('express');
const waController = require('../controllers/waController');
const authMiddleware = require('../middleware/authMiddleware');

const router = Router();

// Semua route WA butuh auth — user_id diambil dari JWT, bukan body/params
router.get('/session/status', authMiddleware, waController.status);
router.post('/session/start', authMiddleware, waController.start);
router.post('/session/logout', authMiddleware, waController.logout);

module.exports = router;
