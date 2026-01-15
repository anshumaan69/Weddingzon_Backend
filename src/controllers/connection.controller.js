const ConnectionRequest = require('../models/ConnectionRequest');
const PhotoAccessRequest = require('../models/PhotoAccessRequest');
const DetailsAccessRequest = require('../models/DetailsAccessRequest');
const User = require('../models/User'); // Kept if needed, though mostly using req.user
const logger = require('../utils/logger');

// Helper to resolve user by ID or Username
const resolveUser = async (identifier) => {
    // If it looks like an ObjectId, try ID first (legacy support), otherwise Username
    if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
        const user = await User.findById(identifier);
        if (user) return user;
    }
    const user = await User.findOne({ username: identifier });
    if (!user) throw new Error('User not found');
    return user;
};

// @desc    Send Connection Request (Interest)
// @route   POST /api/connections/send
// @access  Private
exports.sendConnectionRequest = async (req, res) => {
    try {
        const { targetUsername } = req.body;
        const requesterId = req.user.id;

        if (!targetUsername) return res.status(400).json({ message: 'Target username is required' });

        let targetUser;
        try {
            targetUser = await resolveUser(targetUsername);
        } catch (e) {
            return res.status(404).json({ message: 'User not found' });
        }
        const targetUserId = targetUser._id.toString();

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

        logger.info(`Connection Request Sent: ${req.user.username} -> ${targetUser.username}`);
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

// @desc    Get Incoming Requests (Pending)
// @route   GET /api/connections/requests
// @access  Private
// @desc    Get Incoming Requests (Unified: Connection, Photo, Details)
// @route   GET /api/connections/requests
// @access  Private
exports.getIncomingRequests = async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store'); // Disable caching
        const myId = req.user.id;

        const [connectionRequests, photoRequests, detailsRequests] = await Promise.all([
            ConnectionRequest.find({ recipient: myId, status: 'pending' })
                .populate('requester', 'username first_name last_name profilePhoto occupation city state country age')
                .lean(),
            PhotoAccessRequest.find({ targetUser: myId, status: 'pending' })
                .populate('requester', 'username first_name last_name profilePhoto occupation city state country age')
                .lean(),
            DetailsAccessRequest.find({ targetUser: myId, status: 'pending' })
                .populate('requester', 'username first_name last_name profilePhoto occupation city state country age')
                .lean()
        ]);

        logger.info(`Fetching Requests for ${myId}`, {
            connCount: connectionRequests.length,
            photoCount: photoRequests.length,
            detailsCount: detailsRequests.length,
            firstConnRequester: connectionRequests[0]?.requester ? 'Populated' : 'Missing',
            firstPhotoRequester: photoRequests[0]?.requester ? 'Populated' : 'Missing',
            firstDetailsRequester: detailsRequests[0]?.requester ? 'Populated' : 'Missing'
        });

        // Standardize structure
        const formattedRequests = [
            ...connectionRequests.map(r => ({ ...r, type: 'connection' })),
            ...photoRequests.map(r => ({ ...r, type: 'photo' })),
            ...detailsRequests.map(r => ({ ...r, type: 'details' }))
        ];

        // Sort by newest first
        formattedRequests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.status(200).json({ success: true, data: formattedRequests });
    } catch (error) {
        logger.error('Get Incoming Requests Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Request Details Access
// @route   POST /api/connections/request-details-access
// @access  Private
exports.requestDetailsAccess = async (req, res) => {
    try {
        const { targetUsername } = req.body;
        const requesterId = req.user.id;

        if (!targetUsername) return res.status(400).json({ message: 'Target username is required' });

        let targetUser;
        try {
            targetUser = await resolveUser(targetUsername);
        } catch (e) {
            return res.status(404).json({ message: 'User not found' });
        }
        const targetUserId = targetUser._id.toString();

        if (requesterId === targetUserId) return res.status(400).json({ message: 'Cannot request access from yourself' });

        const existingRequest = await DetailsAccessRequest.findOne({
            requester: requesterId,
            targetUser: targetUserId,
            status: { $in: ['pending', 'granted'] }
        });

        if (existingRequest) {
            if (existingRequest.status === 'granted') return res.status(400).json({ message: 'Access already granted' });
            return res.status(400).json({ message: 'Request already pending' });
        }

        const newRequest = await DetailsAccessRequest.create({
            requester: requesterId,
            targetUser: targetUserId
        });

        logger.info(`Details Access Requested: ${req.user.username} -> ${targetUser.username}`);
        res.status(201).json({ success: true, message: 'Request sent', data: newRequest });
    } catch (error) {
        logger.error('Request Details Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Respond to Photo Access Request
// @route   POST /api/connections/respond-photo
// @access  Private
exports.respondToPhotoRequest = async (req, res) => {
    try {
        const { requestId, action } = req.body; // action: 'grant' or 'reject'
        const request = await PhotoAccessRequest.findById(requestId);

        if (!request) return res.status(404).json({ message: 'Request not found' });
        if (request.targetUser.toString() !== req.user.id) return res.status(403).json({ message: 'Not authorized' });

        if (action === 'grant') {
            request.status = 'granted';
            request.grantedAt = new Date();
        } else if (action === 'reject') {
            request.status = 'rejected';
            request.rejectedAt = new Date();
        } else {
            return res.status(400).json({ message: 'Invalid action' });
        }

        await request.save();
        res.status(200).json({ success: true, message: `Photo access ${action}ed` });
    } catch (error) {
        logger.error('Respond Photo Request Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Respond to Details Access Request
// @route   POST /api/connections/respond-details
// @access  Private
exports.respondToDetailsRequest = async (req, res) => {
    try {
        const { requestId, action } = req.body;
        const request = await DetailsAccessRequest.findById(requestId);

        if (!request) return res.status(404).json({ message: 'Request not found' });
        if (request.targetUser.toString() !== req.user.id) return res.status(403).json({ message: 'Not authorized' });

        if (action === 'grant') {
            request.status = 'granted';
            request.grantedAt = new Date();
        } else if (action === 'reject') {
            request.status = 'rejected';
            request.rejectedAt = new Date();
        } else {
            return res.status(400).json({ message: 'Invalid action' });
        }

        await request.save();
        res.status(200).json({ success: true, message: `Details access ${action}ed` });
    } catch (error) {
        logger.error('Respond Details Request Error', { error: error.message });
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
        const { targetUsername } = req.body;
        const requesterId = req.user.id;

        if (!targetUsername) return res.status(400).json({ message: 'Target username is required' });

        let targetUser;
        try {
            targetUser = await resolveUser(targetUsername);
        } catch (e) {
            return res.status(404).json({ message: 'User not found' });
        }
        const targetUserId = targetUser._id.toString();

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
            logger.debug(`Duplicate Photo Access Request: ${req.user.username} -> ${targetUser.username}`);
            return res.status(400).json({ message: 'Request already pending' });
        }

        const newRequest = await PhotoAccessRequest.create({
            requester: requesterId,
            targetUser: targetUserId,
            status: 'pending'
        });

        logger.info(`Photo Access Requested: ${req.user.username} -> ${targetUser.username}`);
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
        const { username } = req.params;
        const requesterId = req.user.id;

        let targetUser;
        try {
            targetUser = await resolveUser(username);
        } catch (e) {
            return res.status(404).json({ message: 'User not found' });
        }
        const targetUserId = targetUser._id.toString();

        const [photoRequest, connRequest, detailsRequest] = await Promise.all([
            PhotoAccessRequest.findOne({
                requester: requesterId,
                targetUser: targetUserId
            }),
            ConnectionRequest.findOne({
                requester: requesterId,
                recipient: targetUserId
            }),
            DetailsAccessRequest.findOne({
                requester: requesterId,
                targetUser: targetUserId
            })
        ]);

        res.status(200).json({
            success: true,
            status: photoRequest ? photoRequest.status : null, // 'status' = photo access
            friendStatus: connRequest ? connRequest.status : null, // 'friendStatus' = connection
            detailsStatus: detailsRequest ? detailsRequest.status : null // 'detailsStatus' = details access
        });

    } catch (error) {
        logger.error('Check Status Error', { user: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
// @desc    Cancel Request
// @route   POST /api/connections/cancel
// @access  Private
exports.cancelRequest = async (req, res) => {
    try {
        const { targetUsername, type } = req.body;
        const requesterId = req.user.id;

        if (!targetUsername || !type) return res.status(400).json({ message: 'Target username and type are required' });

        let targetUser;
        try {
            targetUser = await resolveUser(targetUsername);
        } catch (e) {
            return res.status(404).json({ message: 'User not found' });
        }
        const targetUserId = targetUser._id.toString();

        let result;
        if (type === 'connection') {
            result = await ConnectionRequest.findOneAndDelete({ requester: requesterId, recipient: targetUserId, status: 'pending' });
        } else if (type === 'photo') {
            result = await PhotoAccessRequest.findOneAndDelete({ requester: requesterId, targetUser: targetUserId, status: 'pending' });
        } else if (type === 'details') {
            result = await DetailsAccessRequest.findOneAndDelete({ requester: requesterId, targetUser: targetUserId, status: 'pending' });
        } else {
            return res.status(400).json({ message: 'Invalid request type' });
        }

        if (!result) return res.status(404).json({ message: 'No pending request found to cancel' });

        logger.info(`Request Cancelled: ${req.user.username} -> ${targetUser.username} [${type}]`);
        res.status(200).json({ success: true, message: 'Request cancelled' });

    } catch (error) {
        logger.error('Cancel Request Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
