const { admin, initialized } = require('../config/firebase');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Send Multicast Notification
 * @param {Array<string>} userIds - List of User IDs to notify
 * @param {Object} payload - { title, body, data }
 */
exports.sendPushNotification = async (userIds, { title, body, data = {} }) => {
    if (!initialized) {
        logger.debug(`Push Notification Skipped (Firebase Not Init): ${title}`);
        return;
    }

    try {
        // Fetch users with tokens
        const users = await User.find({ _id: { $in: userIds } }).select('fcmTokens');

        let allTokens = [];
        users.forEach(user => {
            if (user.fcmTokens && user.fcmTokens.length > 0) {
                allTokens = allTokens.concat(user.fcmTokens);
            }
        });

        // Filter duplicates and empty
        allTokens = [...new Set(allTokens)].filter(t => t);

        if (allTokens.length === 0) return;

        const message = {
            notification: { title, body },
            data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' }, // Standard for Flutter
            tokens: allTokens
        };

        const response = await admin.messaging().sendMulticast(message);

        // Handle Invalid Tokens (Cleanup)
        if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(allTokens[idx]);
                }
            });

            if (failedTokens.length > 0) {
                await User.updateMany(
                    { fcmTokens: { $in: failedTokens } },
                    { $pull: { fcmTokens: { $in: failedTokens } } }
                );
                logger.info(`Removed ${failedTokens.length} invalid FCM tokens`);
            }
        }

        logger.info(`Push Sent: "${title}" to ${response.successCount} devices`);

    } catch (error) {
        logger.error('Send Push Error', { error: error.message });
    }
};

/**
 * Simple wrapper for single user
 */
exports.notifyUser = async (userId, payload) => {
    return this.sendPushNotification([userId], payload);
};
