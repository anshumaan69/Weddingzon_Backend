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
    getNotifications,
    cancelRequest,
    deleteConnection
} = require('../controllers/connection.controller');
const { protect } = require('../middlewares/authMiddleware');
const { ensureProfileComplete } = require('../middlewares/profileMiddleware');

router.post('/request-photo-access', protect, ensureProfileComplete, requestPhotoAccess);
router.post('/request-details-access', protect, ensureProfileComplete, requestDetailsAccess);
router.post('/respond-photo', protect, ensureProfileComplete, respondToPhotoRequest);
router.post('/respond-details', protect, ensureProfileComplete, respondToDetailsRequest);
router.get('/status/:username', protect, ensureProfileComplete, checkConnectionStatus); // Updated param to username

// New Routes for Connections (Chat Friends)
router.post('/send', protect, ensureProfileComplete, sendConnectionRequest);
router.post('/accept', protect, ensureProfileComplete, acceptConnectionRequest);
router.post('/reject', protect, ensureProfileComplete, rejectConnectionRequest);
router.delete('/delete', protect, ensureProfileComplete, deleteConnection); // Added delete connection route
router.post('/cancel', protect, ensureProfileComplete, cancelRequest); // New Cancel Route
router.get('/my-connections', protect, ensureProfileComplete, getConnections);
router.get('/requests', protect, ensureProfileComplete, getIncomingRequests);
router.get('/notifications', protect, ensureProfileComplete, getNotifications);

module.exports = router;
