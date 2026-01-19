const admin = require('firebase-admin');
const path = require('path');
const logger = require('../utils/logger');

let initialized = false;

try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    initialized = true;
    logger.info('Firebase Admin Initialized Successfully');
} catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
        logger.warn('Firebase Service Account Key NOT FOUND. Push Notifications will differ/fail. Please add src/config/serviceAccountKey.json');
        // Initialize with default creds (useful if running in Google Cloud env, but likely not local)
        // admin.initializeApp(); 
    } else {
        logger.error('Firebase Initialization Error:', error);
    }
}

module.exports = { admin, initialized };
