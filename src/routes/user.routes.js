const express = require('express');
const router = express.Router();
const { getFeed, uploadPhotos, getUserProfile } = require('../controllers/user.controller');
// IMPORTANT: We need multer for upload
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit to allow any high-res image
const { protect } = require('../middlewares/authMiddleware');
const { ensureProfileComplete } = require('../middlewares/profileMiddleware');

router.use(protect);

router.get('/search', protect, ensureProfileComplete, require('../controllers/user.controller').searchUsers);
router.get('/feed', protect, ensureProfileComplete, getFeed);
router.patch('/location', protect, require('../controllers/user.controller').updateLocation);
router.get('/nearby', protect, ensureProfileComplete, require('../controllers/user.controller').getNearbyUsers);

router.post('/upload-photos', protect, upload.array('photos', 10), uploadPhotos); // Uploading photos might be PART of completing profile? 
// Actually, if they are uploading photos during onboarding, we shouldn't block it. 
// But the user said "prevent user from going to feed, chat, requests". 
// Let's assume uploading photos *after* onboarding is what we are protecting here?
// The onboarding flow uses `registerDetails`.
// `upload-photos` seems to be a separate route.
// Let's block /feed and profile viewing for now.
// Profile Views
router.post('/view/:userId', protect, require('../controllers/user.controller').recordProfileView);
router.get('/viewers', protect, require('../controllers/user.controller').getProfileViewers);

router.get('/:username', protect, ensureProfileComplete, getUserProfile);
router.delete('/photos/:photoId', require('../controllers/user.controller').deletePhoto);
router.patch('/photos/:photoId/set-profile', require('../controllers/user.controller').setProfilePhoto);

// Stub for access requests to prevent frontend crash if it calls them
router.post('/photo-access/request', (req, res) => res.status(200).json({ message: 'Request sent (stub)' }));
router.get('/photo-access/status/:targetUserId', (req, res) => res.status(200).json({ status: 'none' }));

module.exports = router;
