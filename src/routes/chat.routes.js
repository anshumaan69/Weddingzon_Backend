const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { getChatHistory, getConversations } = require('../controllers/chat.controller');

router.use(protect);

router.get('/history/:userId', getChatHistory);
router.get('/conversations', getConversations);

module.exports = router;
