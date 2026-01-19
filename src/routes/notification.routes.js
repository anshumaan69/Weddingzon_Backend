const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { registerToken, unregisterToken } = require('../controllers/notification.controller');

router.post('/register-token', protect, registerToken);
router.post('/unregister-token', protect, unregisterToken);

module.exports = router;
