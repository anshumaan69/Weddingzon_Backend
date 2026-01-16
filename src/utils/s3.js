const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client: defaultClient } = require('../config/s3');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3'); // Added PutObjectCommand back since it was missing? No, it was used in uploadlocal. Wait, I need it here.
const crypto = require('crypto');
const logger = require('./logger');
const Cache = require('./cache'); // Import central cache

exports.uploadToS3 = async (file, folder = 'uploads', client = defaultClient, bucketName = process.env.AWS_BUCKET_NAME) => {
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${folder}/${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
    });

    await client.send(command);

    // Return the URL and Key
    return {
        Location: `https://${bucketName}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${fileName}`,
        Key: fileName
    };
};

exports.getSignedFileUrl = async (fileUrlOrKey, client = defaultClient, bucketName = process.env.AWS_BUCKET_NAME) => {
    try {
        if (!fileUrlOrKey) return null;

        let key = fileUrlOrKey;

        // If it's a full URL, extract the key
        if (fileUrlOrKey.startsWith('http')) {
            const bucketDomain = `${bucketName}.s3`;
            if (fileUrlOrKey.includes(bucketDomain)) {
                // Split by .amazonaws.com/ to get the key reliably
                const parts = fileUrlOrKey.split('.amazonaws.com/');
                if (parts.length > 1) {
                    key = parts[1];
                    // Strip query parameters if present (e.g. if URL was already signed)
                    if (key.includes('?')) {
                        key = key.split('?')[0];
                    }
                }
            }
        }

        const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: key,
        });

        // Sign the URL, valid for 1 hour
        const signedUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
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
    if (cachedUrl) {
        return cachedUrl;
    }

    try {
        const command = new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: key });
        // URL valid for 1 hour (3600s)
        const url = await getSignedUrl(defaultClient, command, { expiresIn: 3600 });

        // 2. Set Cache (55 mins to be safe)
        Cache.set(key, url, 1000 * 60 * 55);

        return url;
    } catch (error) {
        logger.error('Presign URL Error', { key, error: error.message });
        return null;
    }
};
