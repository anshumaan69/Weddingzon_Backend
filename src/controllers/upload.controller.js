const { uploadToS3 } = require('../utils/s3');
const { chatS3Client } = require('../config/s3'); // Import chat client
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

        // Use chatS3Client explicitely as it has better permissions
        const result = await uploadToS3(file, folder, chatS3Client);

        res.status(200).json({
            success: true,
            url: result.Location, // Fixed: s3 utility returns Location, not url
            key: result.key
        });
    } catch (error) {
        logger.error('Upload Error', { error: error.message });
        res.status(500).json({ message: 'File upload failed', error: error.message });
    }
};
