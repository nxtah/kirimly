const { Router } = require('express');
const blastController = require('../controllers/blastController');
const authMiddleware = require('../middleware/authMiddleware');

const router = Router();

router.get('/',              authMiddleware, blastController.list);
router.post('/',             authMiddleware, blastController.create);
router.get('/:id',           authMiddleware, blastController.detail);
router.get('/:id/messages',  authMiddleware, blastController.messages);
router.post('/:id/cancel',   authMiddleware, blastController.cancel);
router.post('/:id/retry',    authMiddleware, blastController.retry);

module.exports = router;
