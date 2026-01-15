const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3Client = require('../config/s3');
const crypto = require('crypto');
const logger = require('./logger');
const Cache = require('./cache'); // Import central cache

const BUCKET_NAME = process.env.AWS_BUCKET_NAME; // Ensure this is available

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

// Cached wrapper for signing
exports.getPreSignedUrl = async (key) => {
    if (!key) return null;

    // 1. Check Cache
    const cachedUrl = Cache.get(key);
    if (cachedUrl) return cachedUrl;

    try {
        const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
        // URL valid for 1 hour (3600s)
        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        // 2. Set Cache (55 mins to be safe)
        Cache.set(key, url, 1000 * 60 * 55);

        return url;
    } catch (error) {
        logger.error('Presign URL Error', { key, error: error.message });
        return null;
    }
};
