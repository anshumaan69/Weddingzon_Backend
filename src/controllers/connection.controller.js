const ConnectionRequest = require('../models/ConnectionRequest');
const PhotoAccessRequest = require('../models/PhotoAccessRequest');
const User = require('../models/User'); // Kept if needed, though mostly using req.user
const logger = require('../utils/logger');

// @desc    Send Connection Request (Interest)
// @route   POST /api/connections/send
// @access  Private
exports.sendConnectionRequest = async (req, res) => {
    try {
        const { targetUserId } = req.body;
        const requesterId = req.user.id;

        if (requesterId === targetUserId) {
            return res.status(400).json({ message: 'Cannot connect with yourself' });
        }

        const existingRequest = await ConnectionRequest.findOne({
            requester: requesterId,
            recipient: targetUserId
        });

        if (existingRequest) {
            return res.status(400).json({ message: 'Request already sent' });
        }

        const newRequest = await ConnectionRequest.create({
            requester: requesterId,
            recipient: targetUserId,
            status: 'pending'
        });

        logger.info(`Connection Request Sent: ${req.user.username} -> ${targetUserId}`);
        res.status(201).json({ success: true, data: newRequest });

    } catch (error) {
        logger.error('Send Connection Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Accept Connection Request
// @route   POST /api/connections/accept
// @access  Private
exports.acceptConnectionRequest = async (req, res) => {
    try {
        const { requestId } = req.body;

        const request = await ConnectionRequest.findById(requestId);
        if (!request) return res.status(404).json({ message: 'Request not found' });

        if (request.recipient.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        request.status = 'accepted';
        await request.save();

        res.status(200).json({ success: true, message: 'Connection Accepted' });
    } catch (error) {
        logger.error('Accept Connection Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get Incoming Requests (Pending)
// @route   GET /api/connections/requests
// @access  Private
exports.getIncomingRequests = async (req, res) => {
    try {
        const myId = req.user.id;

        const requests = await ConnectionRequest.find({
            recipient: myId,
            status: 'pending'
        }).populate('requester', 'username first_name last_name profilePhoto occupation city state country age');

        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        logger.error('Get Incoming Requests Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Reject Connection Request
// @route   POST /api/connections/reject
// @access  Private
exports.rejectConnectionRequest = async (req, res) => {
    try {
        const { requestId } = req.body;

        const request = await ConnectionRequest.findById(requestId);
        if (!request) return res.status(404).json({ message: 'Request not found' });

        if (request.recipient.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        request.status = 'rejected';
        await request.save();

        res.status(200).json({ success: true, message: 'Connection Rejected' });
    } catch (error) {
        logger.error('Reject Connection Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// Keep existing getConnections logic too...
// @desc    Get My Connections (Accepted)
// @route   GET /api/connections/my-connections
// @access  Private
exports.getConnections = async (req, res) => {
    // ... (Keep existing implementation)
    try {
        const myId = req.user.id;
        // Find requests where I am requester OR recipient AND status is accepted
        const connections = await ConnectionRequest.find({
            $or: [
                { requester: myId, status: 'accepted' },
                { recipient: myId, status: 'accepted' }
            ]
        })
            .populate('requester', 'username first_name last_name profilePhoto')
            .populate('recipient', 'username first_name last_name profilePhoto');

        // Format data to return just the "other" user
        const formatted = connections.map(conn => {
            const otherUser = conn.requester._id.toString() === myId ? conn.recipient : conn.requester;
            return {
                _id: otherUser._id,
                username: otherUser.username,
                displayName: `${otherUser.first_name || ''} ${otherUser.last_name || ''}`.trim() || otherUser.username,
                profilePhoto: otherUser.profilePhoto
            };
        });

        res.status(200).json({ success: true, data: formatted });

    } catch (error) {
        logger.error('Get Connections Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// Keep existing exports...
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

// @desc    Check Access Status (Photo & Connection)
// @route   GET /api/connections/status/:targetUserId
// @access  Private
exports.checkConnectionStatus = async (req, res) => {
    try {
        const { targetUserId } = req.params;
        const requesterId = req.user.id;

        const [photoRequest, connRequest] = await Promise.all([
            PhotoAccessRequest.findOne({
                requester: requesterId,
                targetUser: targetUserId
            }),
            ConnectionRequest.findOne({
                requester: requesterId,
                recipient: targetUserId
            })
        ]);

        res.status(200).json({
            success: true,
            status: photoRequest ? photoRequest.status : null, // 'status' = photo access
            friendStatus: connRequest ? connRequest.status : null // 'friendStatus' = connection
        });

    } catch (error) {
        logger.error('Check Status Error', { user: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
