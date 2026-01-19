const admin = require('firebase-admin');
const path = require('path');
const logger = require('../utils/logger');

let initialized = false;

try {
    let serviceAccount;
    try {
        // 1. Try Local File (Dev)
        serviceAccount = require('./serviceAccountKey.json');
    } catch (e) {
        // 2. Try Environment Variable (Prod/Deployment)
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        }
    }

    if (serviceAccount) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        initialized = true;
        logger.info('Firebase Admin Initialized Successfully');
    } else {
        throw new Error('No Service Account Key found (File or Env Var)');
    }

} catch (error) {
    if (error.message.includes('No Service Account')) {
        logger.warn('Firebase Service Account Key NOT FOUND. Push Notifications will differ/fail.');
        logger.warn('For Deployment: Set FIREBASE_SERVICE_ACCOUNT env var with the JSON content.');
    } else {
        logger.error('Firebase Initialization Error:', error);
    }
}

module.exports = { admin, initialized };
