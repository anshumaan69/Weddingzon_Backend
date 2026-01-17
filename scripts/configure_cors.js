require('dotenv').config();
const { S3Client, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

// Initialize S3 Client using existing environment variables
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

const corsParams = {
    Bucket: BUCKET_NAME,
    CORSConfiguration: {
        CORSRules: [
            {
                AllowedHeaders: ['*'],
                AllowedMethods: ['GET', 'HEAD'],
                AllowedOrigins: ['*'], // Allow all for now (including localhost)
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3000
            }
        ]
    }
};

const run = async () => {
    try {
        console.log(`Configuring CORS for bucket: ${BUCKET_NAME}...`);
        const command = new PutBucketCorsCommand(corsParams);
        await s3Client.send(command);
        console.log('Successfully updated S3 CORS configuration!');
    } catch (err) {
        console.error('Error configuring CORS:', err);
    }
};

run();
