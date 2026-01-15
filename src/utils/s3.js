const { PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const crypto = require('crypto');

exports.uploadToS3 = async (file, folder = 'uploads') => {
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${folder}/${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;

    const command = new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        // ACL: 'public-read' // Remove if bucket policies handle public access or if you use CloudFront
    });

    await s3Client.send(command);

    // Return the URL
    // Assuming public access or CloudFront. If completely private, you'd need a signed URL.
    // For this app, let's assume standard public object URL structure.
    return {
        Location: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${fileName}`,
        Key: fileName
    };
};
