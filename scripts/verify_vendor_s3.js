require('dotenv').config();
const { vendorS3Client } = require('../src/config/s3');
const { ListBucketsCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

async function verifyVendorS3() {
    try {
        console.log('Verifying Vendor S3 Credentials...');
        console.log('Region:', process.env.AWS_REGION || 'ap-south-1');

        // 1. Connectivity Check
        const listCmd = new ListBucketsCommand({});
        const data = await vendorS3Client.send(listCmd);
        console.log('✔ Connectivity confirmed. Buckets available:', data.Buckets.length);

        // 2. Permission Check (Upload to restricted path - TYPO CHECK)
        const bucketName = process.env.AWS_BUCKET_NAME || 'hoocai';
        // Try the CORRECT spelling 'weddingzon' instead of 'weedingzon'
        const testKey = 'weddingzon/users/test-vendor/verify_upload.txt';

        console.log(`Attempting upload to: s3://${bucketName}/${testKey}`);

        const uploadCmd = new PutObjectCommand({
            Bucket: bucketName,
            Key: testKey,
            Body: 'Verification test content (Spelling Check)',
            ContentType: 'text/plain'
        });

        await vendorS3Client.send(uploadCmd);
        console.log('✔ Upload successful! The policy uses "weddingzon" (correct spelling).');

    } catch (err) {
        console.error('❌ Verification Failed:', err.message);
        if (err.Code === 'AccessDenied') {
            console.error('   Reason: The specific IAM policy likely does not allow PutObject on the tested path.');
        }
    }
}

verifyVendorS3();
