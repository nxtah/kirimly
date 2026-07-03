const { Router } = require('express');
const logController = require('../controllers/logController');
const authMiddleware = require('../middleware/authMiddleware');

const router = Router();

router.get('/', authMiddleware, logController.listLogs);

module.exports = router;
