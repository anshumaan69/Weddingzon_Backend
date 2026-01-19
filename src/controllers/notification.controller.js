const User = require('../models/User');
const logger = require('../utils/logger');

// @desc    Register FCM Token
// @route   POST /api/notifications/register-token
// @access  Private
exports.registerToken = async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ message: 'Token is required' });

        await User.findByIdAndUpdate(req.user._id, {
            $addToSet: { fcmTokens: token }
        });

        res.status(200).json({ success: true, message: 'Token registered' });
    } catch (error) {
        logger.error('Register Token Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Unregister FCM Token (Logout)
// @route   POST /api/notifications/unregister-token
// @access  Private
exports.unregisterToken = async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ message: 'Token is required' });

        await User.findByIdAndUpdate(req.user._id, {
            $pull: { fcmTokens: token }
        });

        res.status(200).json({ success: true, message: 'Token unregistered' });
    } catch (error) {
        logger.error('Unregister Token Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
