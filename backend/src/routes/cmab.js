const { Router } = require('express');
const cmabController = require('../controllers/cmabController');
const authMiddleware = require('../middleware/authMiddleware');

const router = Router();

router.post('/recommend',        authMiddleware, cmabController.recommend);
router.get('/performance',       authMiddleware, cmabController.performance);
router.get('/decisions/latest',  authMiddleware, cmabController.latestDecision);

module.exports = router;
