const Chat = require('../models/Chat');
const User = require('../models/User');
const logger = require('../utils/logger');
const { uploadToS3, getSignedFileUrl } = require('../utils/s3'); // Assuming you have this utility

// @desc    Get Chat History
// @route   GET /api/chat/history/:userId
// @access  Private
exports.getChatHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const myId = req.user.id;
        const { page = 1, limit = 50 } = req.query;

        // Deterministic Conversation ID
        const conversationId = [myId, userId].sort().join('_');

        // Optimized Query: Uses conversationId index
        // Note: This effectively hides old messages created before this schema update
        // unless a migration script is run to populate conversationId on them.
        const messages = await Chat.find({
            conversationId
        })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate('sender', 'username profilePhoto')
            .populate('receiver', 'username profilePhoto')
            .lean();

        // Sign the image URLs
        const signedMessages = await Promise.all(messages.map(async (msg) => {
            if (msg.type === 'image' && msg.mediaUrl) {
                msg.mediaUrl = await getSignedFileUrl(msg.mediaUrl);
            }
            return msg;
        }));

        res.status(200).json({ success: true, data: signedMessages.reverse() }); // Reverse to show oldest to newest
    } catch (error) {
        logger.error('Get Chat History Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Mark Messages as Read
// @route   POST /api/chat/read
// @access  Private
exports.markAsRead = async (req, res) => {
    try {
        const { senderId } = req.body;
        const myId = req.user.id;

        await Chat.updateMany(
            { sender: senderId, receiver: myId, read: false },
            { read: true, readAt: new Date() }
        );

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Mark Read Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get Recent Conversations (Message Box)
// @route   GET /api/chat/conversations
// @access  Private
exports.getRecentConversations = async (req, res) => {
    try {
        const myId = req.user.id; // Use ObjectId in aggregation if needed
        const mongoose = require('mongoose');
        const myObjectId = new mongoose.Types.ObjectId(myId);

        const pipeline = [
            {
                $match: {
                    $or: [{ sender: myObjectId }, { receiver: myObjectId }]
                }
            },
            {
                $sort: { createdAt: -1 }
            },
            {
                $group: {
                    _id: {
                        $cond: [
                            { $eq: ['$sender', myObjectId] },
                            '$receiver',
                            '$sender'
                        ]
                    },
                    lastMessage: { $first: '$message' },
                    lastMessageAt: { $first: '$createdAt' },
                    unreadCount: {
                        $sum: {
                            $cond: [{ $and: [{ $eq: ['$receiver', myObjectId] }, { $eq: ['$read', false] }] }, 1, 0]
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'userInfo'
                }
            },
            { $unwind: '$userInfo' },
            {
                $project: {
                    _id: 1,
                    username: '$userInfo.username',
                    first_name: '$userInfo.first_name',
                    last_name: '$userInfo.last_name',
                    profilePhoto: '$userInfo.profilePhoto',
                    lastMessage: 1,
                    lastMessageAt: 1,
                    unreadCount: 1
                }
            },
            { $sort: { lastMessageAt: -1 } }
        ];

        const conversations = await Chat.aggregate(pipeline);
        res.status(200).json({ success: true, data: conversations });

    } catch (error) {
        logger.error('Get Conversations Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Upload Chat Image
// @route   POST /api/chat/upload
// @access  Private
exports.uploadChatImage = async (req, res) => {
    try {
        logger.info('Upload Request Received');
        if (!req.file) {
            logger.warn('Upload Failed: No file provided in request');
            return res.status(400).json({ message: 'No file uploaded' });
        }

        logger.info(`Uploading File: ${req.file.originalname} (${req.file.mimetype}, ${req.file.size} bytes)`);
        const result = await uploadToS3(req.file, 'chat-images');
        logger.info(`Upload Success: ${result.Location}`);

        // Generate a signed URL for immediate use
        const signedUrl = await getSignedFileUrl(result.Key);

        res.status(200).json({ success: true, url: signedUrl });
    } catch (error) {
        logger.error('Chat Upload Error', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Server Error: ' + error.message });
    }
};
