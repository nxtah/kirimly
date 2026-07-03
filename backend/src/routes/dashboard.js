const { Router } = require('express');
const dashboardController = require('../controllers/dashboardController');
const authMiddleware = require('../middleware/authMiddleware');

const router = Router();

router.get('/stats', authMiddleware, dashboardController.stats);

module.exports = router;
