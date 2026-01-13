const ConnectionRequest = require('../models/ConnectionRequest');
const User = require('../models/User');

// @desc    Send Connection Request
// @route   POST /api/connections/request/:recipientId
// @access  Private
exports.sendRequest = async (req, res) => {
    try {
        const { recipientId } = req.params;
        const requesterId = req.user.id;

        if (requesterId === recipientId) {
            return res.status(400).json({ message: 'Cannot connect with yourself' });
        }

        const recipient = await User.findById(recipientId);
        if (!recipient) {
            return res.status(404).json({ message: 'User not found' });
        }

        const existingRequest = await ConnectionRequest.findOne({
            $or: [
                { requester: requesterId, recipient: recipientId },
                { requester: recipientId, recipient: requesterId },
            ],
        });

        if (existingRequest) {
            if (existingRequest.status === 'pending') {
                return res.status(400).json({ message: 'Request already pending' });
            }
            if (existingRequest.status === 'accepted') {
                return res.status(400).json({ message: 'Already connected' });
            }
            // If rejected, maybe allow re-request after some time? For now, block.
            return res.status(400).json({ message: 'Request previously rejected' });
        }

        const newRequest = new ConnectionRequest({
            requester: requesterId,
            recipient: recipientId,
        });

        await newRequest.save();

        res.status(200).json({ success: true, message: 'Request sent successfully' });
    } catch (error) {
        console.error('Send Request Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get Connection Status for a User (to show proper button state)
// @route   GET /api/connections/status/:userId
exports.getConnectionStatus = async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUserId = req.user.id;

        const request = await ConnectionRequest.findOne({
            $or: [
                { requester: currentUserId, recipient: userId },
                { requester: userId, recipient: currentUserId },
            ],
        });

        if (!request) return res.status(200).json({ status: 'none' });

        return res.status(200).json({
            status: request.status,
            isSender: request.requester.toString() === currentUserId
        });

    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

const PhotoAccessRequest = require('../models/PhotoAccessRequest');

// @desc    Request Photo Access (Sent to Admin/Target)
// @route   POST /api/connections/request-photo-access
// @access  Private
exports.requestPhotoAccess = async (req, res) => {
    try {
        const { targetUserId } = req.body;
        const requesterId = req.user.id;

        if (requesterId === targetUserId) {
            return res.status(400).json({ message: 'Cannot request access from yourself' });
        }

        // Check if already requested
        const existingRequest = await PhotoAccessRequest.findOne({
            requester: requesterId,
            targetUser: targetUserId,
            status: 'pending'
        });

        if (existingRequest) {
            return res.status(400).json({ message: 'Request already pending' });
        }

        // Check if already granted
        const grantedRequest = await PhotoAccessRequest.findOne({
            requester: requesterId,
            targetUser: targetUserId,
            status: 'granted'
        });

        if (grantedRequest) {
            return res.status(400).json({ message: 'Access already granted' });
        }

        const newRequest = await PhotoAccessRequest.create({
            requester: requesterId,
            targetUser: targetUserId,
            status: 'pending'
        });

        res.status(201).json({ success: true, message: 'Request sent to admin for approval', data: newRequest });
    } catch (error) {
        console.error('Request Photo Access Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};
