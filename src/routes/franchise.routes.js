const express = require('express');
const router = express.Router();
const franchiseController = require('../controllers/franchise.controller');
const { protect } = require('../middlewares/authMiddleware');

// IMPORTANT: We need multer for upload
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 100 * 1024 * 1024 } });

router.post('/payment', protect, franchiseController.submitPayment);
router.post('/create-profile', protect, franchiseController.createFranchiseProfile);
router.get('/profiles', protect, franchiseController.getFranchiseProfiles);
router.put('/profiles/:profileId/preferences', protect, franchiseController.updateProfilePreferences);
router.get('/profiles/:profileId', protect, franchiseController.getMemberProfile);
router.get('/custom-matches/:profileId/pdf', protect, franchiseController.generateMatchPdf); // Added route

// Multi-step Wizard & Photo Support
router.patch('/profiles/:profileId', protect, franchiseController.updateMemberProfile);
router.post('/profiles/:profileId/photos', protect, (req, res, next) => {
    console.log('--- UPLOAD DEBUG ---');
    console.log('Content-Type:', req.headers['content-type']);
    next();
}, upload.array('photos', 10), franchiseController.uploadMemberPhoto);
router.delete('/profiles/:profileId/photos/:photoId', protect, franchiseController.deleteMemberPhoto);
// Note: setProfilePhoto logic for member can be added if needed, reusing delete/upload logic for now.

module.exports = router;
