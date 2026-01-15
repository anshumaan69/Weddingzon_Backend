const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3Client = require('../config/s3');
const crypto = require('crypto');
const logger = require('./logger');

exports.uploadToS3 = async (file, folder = 'uploads') => {
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${folder}/${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;

    const command = new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        // ACL: 'public-read' // Removed as per authorized access plan
    });

    await s3Client.send(command);

    // Return the URL and Key
    return {
        Location: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${fileName}`,
        Key: fileName
    };
};

exports.getSignedFileUrl = async (fileUrlOrKey) => {
    try {
        if (!fileUrlOrKey) return null;

        let key = fileUrlOrKey;

        // If it's a full URL, extract the key
        if (fileUrlOrKey.startsWith('http')) {
            const bucketDomain = `${process.env.AWS_BUCKET_NAME}.s3`;
            if (fileUrlOrKey.includes(bucketDomain)) {
                // Split by .amazonaws.com/ to get the key reliably
                const parts = fileUrlOrKey.split('.amazonaws.com/');
                if (parts.length > 1) {
                    key = parts[1];
                }
            }
        }

        const command = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
        });

        // Sign the URL, valid for 1 hour
        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        return signedUrl;

    } catch (error) {
        logger.error('S3 Signing Error', { error: error.message, key: fileUrlOrKey });
        return fileUrlOrKey; // Fallback to original if signing fails
    }
};
