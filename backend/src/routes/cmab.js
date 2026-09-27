const { Router } = require('express');
const cmabController = require('../controllers/cmabController');
const authMiddleware = require('../middleware/authMiddleware');

const router = Router();

router.post('/recommend',        authMiddleware, cmabController.recommend);
router.get('/performance',       authMiddleware, cmabController.performance);
router.get('/decisions/latest',  authMiddleware, cmabController.latestDecision);
router.get('/summary',           authMiddleware, cmabController.summary);
router.get('/decisions',         authMiddleware, cmabController.decisions);
router.get('/reward-timeseries', authMiddleware, cmabController.rewardTimeseries);
router.post('/evaluate',         authMiddleware, cmabController.evaluate);
router.get('/evaluations',       authMiddleware, cmabController.evaluations);

module.exports = router;
