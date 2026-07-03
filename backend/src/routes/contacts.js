const { Router } = require('express');
const contactController = require('../controllers/contactController');
const authMiddleware = require('../middleware/authMiddleware');

const router = Router();

// Semua route kontak butuh auth — ownership dijamin oleh user_id dari JWT
// Order matters: fixed paths before :id params
router.get('/',              authMiddleware, contactController.list);
router.post('/',             authMiddleware, contactController.create);
router.post('/import',       authMiddleware, contactController.importContacts);
router.delete('/bulk',       authMiddleware, contactController.bulkDelete);
router.put('/:id',           authMiddleware, contactController.update);
router.delete('/:id',        authMiddleware, contactController.remove);

module.exports = router;
