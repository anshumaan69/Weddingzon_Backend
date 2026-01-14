const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { getChatHistory, getConversations } = require('../controllers/chat.controller');

router.use(protect);

const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

router.get('/history/:userId', getChatHistory);
router.get('/conversations', getConversations);
router.post('/upload', upload.single('file'), require('../controllers/chat.controller').uploadMedia);

module.exports = router;
