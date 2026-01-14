const express = require('express');
const router = express.Router();
const { getFeed, uploadPhotos, getUserProfile } = require('../controllers/user.controller');
// IMPORTANT: We need multer for upload
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/search', require('../controllers/user.controller').searchUsers);
router.get('/feed', getFeed);
router.post('/upload-photos', upload.array('photos', 10), uploadPhotos);
router.get('/:username', getUserProfile);
router.delete('/photos/:photoId', require('../controllers/user.controller').deletePhoto);
router.patch('/photos/:photoId/set-profile', require('../controllers/user.controller').setProfilePhoto);

// Stub for access requests to prevent frontend crash if it calls them
router.post('/photo-access/request', (req, res) => res.status(200).json({ message: 'Request sent (stub)' }));
router.get('/photo-access/status/:targetUserId', (req, res) => res.status(200).json({ status: 'none' }));

module.exports = router;
