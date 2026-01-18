const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { ensureProfileComplete } = require('../middlewares/profileMiddleware');
const { getChatHistory, markAsRead, getRecentConversations, uploadChatImage } = require('../controllers/chat.controller');
const multer = require('multer');

// Configure Multer for memory storage (for S3 upload)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

router.get('/history/:userId', protect, ensureProfileComplete, getChatHistory);
router.post('/read', protect, ensureProfileComplete, markAsRead);
router.get('/conversations', protect, ensureProfileComplete, getRecentConversations);
router.post('/upload', protect, ensureProfileComplete, upload.single('image'), uploadChatImage);

module.exports = router;
