const { Router } = require('express');
const controller = require('../controllers/segmentationController');
const authMiddleware = require('../middleware/authMiddleware');

const router = Router();

// Semua route butuh auth — ownership dijamin oleh user_id dari JWT
// Order matters: fixed paths before :id params
router.post('/prospects/import',  authMiddleware, controller.importProspects);
router.get('/prospects/summary',  authMiddleware, controller.prospectSummary);
router.get('/prospects',          authMiddleware, controller.listProspects);
router.delete('/prospects/:id',   authMiddleware, controller.deleteProspect);
router.delete('/prospects',       authMiddleware, controller.resetProspects);

router.get('/suggest-k',          authMiddleware, controller.suggestK);

router.post('/runs',              authMiddleware, controller.createRun);
router.get('/runs',               authMiddleware, controller.listRuns);
router.get('/runs/:id/segments/:no/members', authMiddleware, controller.segmentMembers);
router.get('/runs/:id/details',   authMiddleware, controller.runDetails);
router.get('/runs/:id',           authMiddleware, controller.getRun);
router.delete('/runs/:id',        authMiddleware, controller.deleteRun);

module.exports = router;
