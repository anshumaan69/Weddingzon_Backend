const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadFile } = require('../controllers/upload.controller');
const { protect } = require('../middlewares/authMiddleware');

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Single file upload
router.post('/', protect, upload.single('photo'), uploadFile);

module.exports = router;
