const { uploadToS3 } = require('../utils/s3');
const logger = require('../utils/logger');

// @desc    Upload a single file
// @route   POST /api/uploads
// @access  Private
exports.uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const file = req.file;
        // Generate a folder path based on user ID or 'general'
        const folder = req.user ? `uploads/${req.user._id}` : 'uploads/general';

        // Use existing S3 utility
        // uploadToS3 expects (fileBuffer, fileName, mimeType, folder)
        // Adjusting based on standard usage usually seen
        const result = await uploadToS3(file.buffer, file.originalname, file.mimetype, folder);

        res.status(200).json({
            success: true,
            url: result.url, // Assuming uploadToS3 returns { url, key }
            key: result.key
        });
    } catch (error) {
        logger.error('Upload Error', { error: error.message });
        res.status(500).json({ message: 'File upload failed', error: error.message });
    }
};
