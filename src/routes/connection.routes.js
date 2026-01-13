const express = require('express');
const router = express.Router();
const { requestPhotoAccess, checkConnectionStatus } = require('../controllers/connection.controller');
const { protect } = require('../middlewares/authMiddleware');

router.post('/request-photo-access', protect, requestPhotoAccess);
router.get('/status/:targetUserId', protect, checkConnectionStatus);

module.exports = router;
