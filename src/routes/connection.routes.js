const express = require('express');
const router = express.Router();
const {
    requestPhotoAccess,
    requestDetailsAccess,
    respondToPhotoRequest,
    respondToDetailsRequest,
    checkConnectionStatus,
    sendConnectionRequest,
    acceptConnectionRequest,
    rejectConnectionRequest,
    getConnections,
    getIncomingRequests,
    cancelRequest
} = require('../controllers/connection.controller');
const { protect } = require('../middlewares/authMiddleware');

router.post('/request-photo-access', protect, requestPhotoAccess);
router.post('/request-details-access', protect, requestDetailsAccess);
router.post('/respond-photo', protect, respondToPhotoRequest);
router.post('/respond-details', protect, respondToDetailsRequest);
router.get('/status/:username', protect, checkConnectionStatus); // Updated param to username

// New Routes for Connections (Chat Friends)
router.post('/send', protect, sendConnectionRequest);
router.post('/accept', protect, acceptConnectionRequest);
router.post('/reject', protect, rejectConnectionRequest);
router.post('/cancel', protect, cancelRequest); // New Cancel Route
router.get('/my-connections', protect, getConnections);
router.get('/requests', protect, getIncomingRequests);

module.exports = router;
