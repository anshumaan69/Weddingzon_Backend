const express = require('express');
const router = express.Router();
const { googleAuth, sendOtp, verifyOtp, registerDetails, logout, refreshToken, getMe } = require('../controllers/auth.controller');
const { protect } = require('../middlewares/authMiddleware');
const { csrfProtection } = require('../middlewares/csrfMiddleware');
const rateLimiterMiddleware = require('../middlewares/rateLimiter');

// Public
router.post('/google', googleAuth);
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/refresh', refreshToken);

// Protected
router.post('/register-details', protect, csrfProtection, registerDetails);
router.post('/logout', logout);
router.get('/me', protect, getMe);

module.exports = router;
