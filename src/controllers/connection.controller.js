const User = require('../models/User');
const PhotoAccessRequest = require('../models/PhotoAccessRequest');
const logger = require('../utils/logger');

// @desc    Request Photo Access
// @route   POST /api/connections/request-photo-access
// @access  Private
exports.requestPhotoAccess = async (req, res) => {
    try {
        const { targetUserId } = req.body;
        const requesterId = req.user.id;

        if (!targetUserId) {
            return res.status(400).json({ message: 'Target User ID is required' });
        }

        if (requesterId === targetUserId) {
            logger.warn(`Self-Request for Photo Access: ${req.user.username}`);
            return res.status(400).json({ message: 'Cannot request access from yourself' });
        }

        // Check if a pending or granted request already exists
        const existingRequest = await PhotoAccessRequest.findOne({
            requester: requesterId,
            targetUser: targetUserId,
            status: { $in: ['pending', 'granted'] }
        });

        if (existingRequest) {
            if (existingRequest.status === 'granted') {
                return res.status(400).json({ message: 'Access already granted' });
            }
            logger.debug(`Duplicate Photo Access Request: ${req.user.username} -> ${targetUserId}`);
            return res.status(400).json({ message: 'Request already pending' });
        }

        const newRequest = await PhotoAccessRequest.create({
            requester: requesterId,
            targetUser: targetUserId,
            status: 'pending'
        });

        logger.info(`Photo Access Requested: ${req.user.username} -> ${targetUserId}`);
        res.status(201).json({ success: true, message: 'Request sent successfully', data: newRequest });

    } catch (error) {
        logger.error('Request Photo Access Error', { user: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Check Access Status
// @route   GET /api/connections/status/:targetUserId
// @access  Private
exports.checkConnectionStatus = async (req, res) => {
    try {
        const { targetUserId } = req.params;
        const requesterId = req.user.id;

        const request = await PhotoAccessRequest.findOne({
            requester: requesterId,
            targetUser: targetUserId
        });

        res.status(200).json({
            success: true,
            status: request ? request.status : null
        });

    } catch (error) {
        logger.error('Check Status Error', { user: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
