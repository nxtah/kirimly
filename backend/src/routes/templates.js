const { Router } = require('express');
const templateController = require('../controllers/templateController');
const authMiddleware = require('../middleware/authMiddleware');

const router = Router();

router.get('/',        authMiddleware, templateController.list);
router.post('/',       authMiddleware, templateController.create);
router.put('/:id',     authMiddleware, templateController.update);
router.delete('/:id',  authMiddleware, templateController.remove);

module.exports = router;
