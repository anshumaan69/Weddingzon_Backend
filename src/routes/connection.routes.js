const express = require('express');
const router = express.Router();
const {
    requestPhotoAccess,
    checkConnectionStatus,
    sendConnectionRequest,
    acceptConnectionRequest,
    rejectConnectionRequest,
    getConnections,
    getIncomingRequests
} = require('../controllers/connection.controller');
const { protect } = require('../middlewares/authMiddleware');

router.post('/request-photo-access', protect, requestPhotoAccess);
router.get('/status/:targetUserId', protect, checkConnectionStatus);

// New Routes for Connections (Chat Friends)
router.post('/send', protect, sendConnectionRequest);
router.post('/accept', protect, acceptConnectionRequest);
router.post('/reject', protect, rejectConnectionRequest);
router.get('/my-connections', protect, getConnections);
router.get('/requests', protect, getIncomingRequests);

module.exports = router;
