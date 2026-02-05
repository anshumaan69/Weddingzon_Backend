const express = require('express');
const router = express.Router();
const { getFeed, uploadPhotos, getUserProfile, blockUser, unblockUser, reportUser, updatePartnerPreferences } = require('../controllers/user.controller');
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } });
const { protect, optionalAuth, authorize } = require('../middlewares/authMiddleware');
const { ensureProfileComplete } = require('../middlewares/profileMiddleware');

// === Specific Routes FIRST ===

// Public
router.get('/:username/public-preview', require('../controllers/user.controller').getPublicProfilePreview);
router.get('/search', optionalAuth, require('../controllers/user.controller').searchUsers);
router.get('/feed', protect, authorize('member', 'bride', 'groom', 'admin', 'franchise'), ensureProfileComplete, getFeed);
router.get('/render-image', require('../controllers/user.controller').renderImage);
router.patch('/location', protect, require('../controllers/user.controller').updateLocation);
router.get('/nearby', protect, ensureProfileComplete, require('../controllers/user.controller').getNearbyUsers);
router.post('/upload-photos', protect, upload.array('photos', 10), uploadPhotos);
// cover upload removed

router.post('/block', protect, blockUser);
router.post('/unblock', protect, unblockUser);
router.get('/blocked-users', protect, require('../controllers/user.controller').getBlockedUsers);
router.post('/report', protect, reportUser);
router.put('/preferences', protect, updatePartnerPreferences);

// Profile Views
router.post('/view/:userId', protect, require('../controllers/user.controller').recordProfileView);
router.get('/viewers', protect, require('../controllers/user.controller').getProfileViewers);
router.post('/viewers/mark-read', protect, require('../controllers/user.controller').markProfileViewsAsRead);

router.patch('/photos/:photoId/set-profile', protect, require('../controllers/user.controller').setProfilePhoto);
// set-cover removed
router.delete('/photos/:photoId', protect, require('../controllers/user.controller').deletePhoto);

// Stub for access requests
router.post('/photo-access/request', protect, (req, res) => res.status(200).json({ message: 'Request sent (stub)' }));
router.get('/photo-access/status/:targetUserId', protect, (req, res) => res.status(200).json({ status: 'none' }));

// === Generic Routes LAST ===
router.get('/:username', optionalAuth, getUserProfile); // Generic param route must be last

module.exports = router;
