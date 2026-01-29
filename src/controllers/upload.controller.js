const { s3Client, vendorS3Client } = require('../config/s3');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
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
        const user = req.user;

        console.log('--- DEBUG UPLOAD ---');
        console.log('User:', user ? user._id : 'No User');
        console.log('Role:', user ? user.role : 'N/A');

        // Logic matching user.controller.js (minus blur)
        const fileId = uuidv4();
        // Use 'weedingzon/vendor-img-upload' folder as per IAM Policy screenshot
        const folderPrefix = 'weedingzon/vendor-img-upload';
        const ext = path.extname(file.originalname) || '.jpg';

        // Construct key: uploads/userId/fileId_orig.ext
        let key;
        if (user) {
            key = `${folderPrefix}/${user._id}/${fileId}_orig${ext}`;
        } else {
            key = `${folderPrefix}/general/${fileId}${ext}`;
        }
        console.log('Constructed Key:', key);
        console.log('Folder Prefix:', folderPrefix);

        // Select Client
        const client = (user && user.role === 'vendor') ? vendorS3Client : s3Client;

        const command = new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
        });

        await client.send(command);

        // Construct URL with Region (Critical for correct routing)
        const region = process.env.AWS_REGION || 'ap-south-1';
        const url = `https://${process.env.AWS_BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;

        res.status(200).json({
            success: true,
            url: url,
            key: key
        });
    } catch (error) {
        logger.error('Upload Error', { error: error.message });
        res.status(500).json({ message: 'File upload failed', error: error.message });
    }
};
