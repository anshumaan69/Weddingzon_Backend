const { S3Client } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_CHAT_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_CHAT_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
    }
});

const chatS3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_CHAT_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_CHAT_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
    }
});

module.exports = { s3Client, chatS3Client };
