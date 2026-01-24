const ConnectionRequest = require('../models/ConnectionRequest');
const PhotoAccessRequest = require('../models/PhotoAccessRequest');
const DetailsAccessRequest = require('../models/DetailsAccessRequest');
const User = require('../models/User'); // Kept if needed, though mostly using req.user
const logger = require('../utils/logger');
const { getPreSignedUrl } = require('../utils/s3');
const { notifyUser } = require('../services/notification.service');

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
        const requesterId = req.user._id.toString();

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

        // Notify Recipient (Push)
        notifyUser(targetUserId, {
            title: 'New Connection Request',
            body: `${req.user.first_name || req.user.username} sent you a request!`,
            data: { type: 'connection_request', requesterId }
        });

        // Realtime Socket Emission
        const io = req.app.get('socketio');
        if (io) {
            const populatedRequest = await ConnectionRequest.findById(newRequest._id)
                .populate('requester', 'username first_name last_name profilePhoto occupation city state country age')
                .lean();
            io.to(targetUserId).emit('new_request', { ...populatedRequest, type: 'connection' });
        }

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

        if (request.recipient.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        request.status = 'accepted';
        await request.save();

        // Notify Requester (Push)
        notifyUser(request.requester, {
            title: 'Request Accepted',
            body: `${req.user.first_name || req.user.username} accepted your request!`,
            data: { type: 'request_accepted', userId: req.user._id.toString() }
        });

        // Realtime Socket Emission (Notification)
        const io = req.app.get('socketio');
        if (io) {
            // Emitting to the requester. Structure needs to match getNotifications response.
            // For the requester, 'otherUser' is the one who accepted (req.user).
            io.to(request.requester.toString()).emit('notification', {
                ...request.toObject(),
                type: 'connection',
                otherUser: req.user, // The current user (recipient) is the 'otherUser' for the requester
                updatedAt: new Date()
            });
        }

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

        if (request.recipient.toString() !== req.user._id.toString()) {
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
// @desc    Get Notifications (Accepted Outgoing Requests)
// @route   GET /api/connections/notifications
// @access  Private
exports.getNotifications = async (req, res) => {
    try {
        const myId = req.user._id.toString();

        const [acceptedConnections, grantedPhoto, grantedDetails] = await Promise.all([
            ConnectionRequest.find({ requester: myId, status: 'accepted' })
                .populate('recipient', 'username first_name last_name profilePhoto photos occupation city state country age')
                .lean(),
            PhotoAccessRequest.find({ requester: myId, status: 'granted' })
                .populate('targetUser', 'username first_name last_name profilePhoto photos occupation city state country age')
                .lean(),
            DetailsAccessRequest.find({ requester: myId, status: 'granted' })
                .populate('targetUser', 'username first_name last_name profilePhoto photos occupation city state country age')
                .lean()
        ]);

        // Standardize structure
        // Note: For outgoing requests, the 'other' person is the recipient/targetUser
        const formattedNotifications = [
            ...acceptedConnections.map(r => ({ ...r, type: 'connection', otherUser: r.recipient })),
            ...grantedPhoto.map(r => ({ ...r, type: 'photo', otherUser: r.targetUser })),
            ...grantedDetails.map(r => ({ ...r, type: 'details', otherUser: r.targetUser }))
        ].filter(n => n.otherUser);

        // Sign Profile Photos
        await Promise.all(formattedNotifications.map(async (n) => {
            const user = n.otherUser;
            if (user && user.photos && user.photos.length > 0) {
                const profilePic = user.photos.find(p => p.isProfile) || user.photos[0];
                if (profilePic && profilePic.key) {
                    const signed = await getPreSignedUrl(profilePic.key);
                    if (signed) user.profilePhoto = signed;
                }
            }
            // Remove photos array from response to reduce payload size
            if (user) delete user.photos;
        }));

        // Sort by update time (newest accepted first)
        formattedNotifications.sort((a, b) => {
            const dateA = new Date(a.updatedAt || a.grantedAt || a.createdAt);
            const dateB = new Date(b.updatedAt || b.grantedAt || b.createdAt);
            return dateB - dateA;
        });

        // Limit to 10
        const limitedNotifications = formattedNotifications.slice(0, 10);

        res.status(200).json({ success: true, data: limitedNotifications });
    } catch (error) {
        logger.error('Get Notifications Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get Incoming Requests (Unified: Connection, Photo, Details)
// @route   GET /api/connections/requests
// @access  Private
exports.getIncomingRequests = async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store'); // Disable caching
        const myId = req.user._id.toString();

        const [connectionRequests, photoRequests, detailsRequests] = await Promise.all([
            ConnectionRequest.find({ recipient: myId, status: 'pending' })
                .populate('requester', 'username first_name last_name profilePhoto photos occupation city state country age')
                .lean(),
            PhotoAccessRequest.find({ targetUser: myId, status: 'pending' })
                .populate('requester', 'username first_name last_name profilePhoto photos occupation city state country age')
                .lean(),
            DetailsAccessRequest.find({ targetUser: myId, status: 'pending' })
                .populate('requester', 'username first_name last_name profilePhoto photos occupation city state country age')
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
        ].filter(r => r.requester);

        // Sign Profile Photos
        await Promise.all(formattedRequests.map(async (n) => {
            const user = n.requester;
            if (user && user.photos && user.photos.length > 0) {
                const profilePic = user.photos.find(p => p.isProfile) || user.photos[0];
                if (profilePic && profilePic.key) {
                    const signed = await getPreSignedUrl(profilePic.key);
                    if (signed) user.profilePhoto = signed;
                }
            }
            if (user) delete user.photos;
        }));

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
        const requesterId = req.user._id.toString();

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

        // Realtime Socket Emission
        const io = req.app.get('socketio');
        if (io) {
            const populatedRequest = await DetailsAccessRequest.findById(newRequest._id)
                .populate('requester', 'username first_name last_name profilePhoto occupation city state country age')
                .lean();
            io.to(targetUserId).emit('new_request', { ...populatedRequest, type: 'details' });
        }

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
        if (request.targetUser.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not authorized' });

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

        // Realtime Socket Notification if Granted
        if (action === 'grant') {
            const io = req.app.get('socketio');
            if (io) {
                io.to(request.requester.toString()).emit('notification', {
                    ...request.toObject(),
                    type: 'photo',
                    otherUser: req.user,
                    updatedAt: new Date()
                });
            }
        }

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
        if (request.targetUser.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not authorized' });

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

        // Realtime Socket Notification if Granted
        if (action === 'grant') {
            const io = req.app.get('socketio');
            if (io) {
                io.to(request.requester.toString()).emit('notification', {
                    ...request.toObject(),
                    type: 'details',
                    otherUser: req.user,
                    updatedAt: new Date()
                });
            }
        }

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
        const myId = req.user._id.toString();
        // Find requests where I am requester OR recipient AND status is accepted
        const connections = await ConnectionRequest.find({
            $or: [
                { requester: myId, status: 'accepted' },
                { recipient: myId, status: 'accepted' }
            ]
        })
            .populate('requester', 'username first_name last_name profilePhoto photos occupation city state country age')
            .populate('recipient', 'username first_name last_name profilePhoto photos occupation city state country age')
            .lean(); // Use lean for better performance and modifiability

        // Format data to return just the "other" user
        const formatted = (await Promise.all(connections.map(async (conn) => {
            // Safety Check: If either user is deleted/missing, skip this connection
            if (!conn.requester || !conn.recipient) return null;

            const otherUser = conn.requester._id.toString() === myId ? conn.recipient : conn.requester;

            // Sign Profile Photo
            if (otherUser && otherUser.photos && otherUser.photos.length > 0) {
                const profilePic = otherUser.photos.find(p => p.isProfile) || otherUser.photos[0];
                if (profilePic && profilePic.key) {
                    try {
                        const signed = await getPreSignedUrl(profilePic.key);
                        if (signed) otherUser.profilePhoto = signed;
                    } catch (e) {
                        // ignore signing error
                    }
                }
            }

            return {
                _id: otherUser._id,
                username: otherUser.username,
                first_name: otherUser.first_name,
                last_name: otherUser.last_name,
                displayName: `${otherUser.first_name || ''} ${otherUser.last_name || ''}`.trim() || otherUser.username,
                profilePhoto: otherUser.profilePhoto,
                occupation: otherUser.occupation,
                age: otherUser.age,
                city: otherUser.city,
                state: otherUser.state,
                country: otherUser.country
            };
        }))).filter(Boolean);

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
        const requesterId = req.user._id.toString();

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

        // Realtime Socket Emission
        const io = req.app.get('socketio');
        if (io) {
            const populatedRequest = await PhotoAccessRequest.findById(newRequest._id)
                .populate('requester', 'username first_name last_name profilePhoto occupation city state country age')
                .lean();
            io.to(targetUserId).emit('new_request', { ...populatedRequest, type: 'photo' });
        }

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
        const requesterId = req.user._id.toString();

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
        const requesterId = req.user._id.toString();

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

// @desc    Delete Connection (Remove Friend)
// @route   POST /api/connections/delete
// @access  Private
exports.deleteConnection = async (req, res) => {
    try {
        const { targetUsername } = req.body;
        const requesterId = req.user._id.toString();

        if (!targetUsername) return res.status(400).json({ message: 'Target username is required' });

        let targetUser;
        try {
            targetUser = await resolveUser(targetUsername);
        } catch (e) {
            return res.status(404).json({ message: 'User not found' });
        }
        const targetUserId = targetUser._id.toString();

        // Find and Delete the Connection Request (Accepted)
        const deletedConn = await ConnectionRequest.findOneAndDelete({
            $or: [
                { requester: requesterId, recipient: targetUserId, status: 'accepted' },
                { requester: targetUserId, recipient: requesterId, status: 'accepted' }
            ]
        });

        if (!deletedConn) {
            return res.status(404).json({ message: 'Connection not found' });
        }

        // Also cleanup any Photo/Details access requests between them to ensure clean slate?
        // Optional: Keep them if they re-connect?
        // Better to remove them to enforce privacy.
        await Promise.all([
            PhotoAccessRequest.deleteMany({
                $or: [
                    { requester: requesterId, targetUser: targetUserId },
                    { requester: targetUserId, targetUser: requesterId }
                ]
            }),
            DetailsAccessRequest.deleteMany({
                $or: [
                    { requester: requesterId, targetUser: targetUserId },
                    { requester: targetUserId, targetUser: requesterId }
                ]
            })
        ]);

        logger.info(`Connection Deleted: ${req.user.username} <-> ${targetUser.username}`);

        // Notify via Socket
        const io = req.app.get('socketio');
        if (io) {
            io.to(targetUserId).emit('connection_removed', { userId: requesterId });
        }

        res.status(200).json({ success: true, message: 'Connection deleted' });

    } catch (error) {
        logger.error('Delete Connection Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
