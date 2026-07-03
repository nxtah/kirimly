const { Router } = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const adminOnlyMiddleware = require('../middleware/adminOnlyMiddleware');
const adminController = require('../controllers/adminController');

const router = Router();

// All admin routes require auth + admin role
const adminGuard = [authMiddleware, adminOnlyMiddleware];

// ── User management ──
router.get('/users',              adminGuard, adminController.listUsers);
router.post('/users',             adminGuard, adminController.createUser);
router.put('/users/:id',          adminGuard, adminController.updateUser);
router.delete('/users/:id',       adminGuard, adminController.deleteUser);

// ── Monitoring ──
router.get('/monitoring/sessions',                  adminGuard, adminController.listSessions);
router.get('/monitoring/login-logs',                adminGuard, adminController.listLoginLogs);
router.post('/monitoring/sessions/:userId/terminate', adminGuard, adminController.terminateSession);

// ── Global stats ──
router.get('/stats', adminGuard, adminController.globalStats);

module.exports = router;
