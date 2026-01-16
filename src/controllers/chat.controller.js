const Chat = require('../models/Chat');
const User = require('../models/User');
const logger = require('../utils/logger');

const { uploadToS3, getSignedFileUrl, getPreSignedUrl } = require('../utils/s3');
const { chatS3Client, s3Client } = require('../config/s3'); // Import Chat S3 Client

// Helper to get signed profile photo
const getSignedProfilePhoto = async (user) => {
    if (!user) return null;

    // 1. Google Auth Avatar (Public)
    if (user.auth_provider === 'google' && user.avatar) return user.avatar;

    // 2. Photos Array (S3)
    if (user.photos && user.photos.length > 0) {
        const profile = user.photos.find(p => p.isProfile) || user.photos[0];
        if (profile.key) {
            return await getPreSignedUrl(profile.key);
        }
        return profile.url; // Fallback (might be broken if private)
    }

    // 3. Legacy/Direct profilePhoto field
    if (user.profilePhoto) {
        // If it's a key (no http), sign it
        if (!user.profilePhoto.startsWith('http')) {
            return await getPreSignedUrl(user.profilePhoto);
        }
        return user.profilePhoto;
    }

    return null;
};

// @desc    Get Chat History
// @route   GET /api/chat/history/:userId
// @access  Private
exports.getChatHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const myId = req.user._id.toString();
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
            .populate('sender', 'username profilePhoto photos avatar auth_provider')
            .populate('receiver', 'username profilePhoto photos avatar auth_provider')
            .lean();

        // Sign the image URLs & Profile Photos
        const signedMessages = await Promise.all(messages.map(async (msg) => {
            // Sign Message Media
            if (msg.type === 'image' && msg.mediaUrl) {
                msg.mediaUrl = await getSignedFileUrl(msg.mediaUrl, s3Client);
            }
            // Sign Sender Profile
            if (msg.sender) {
                msg.sender.profilePhoto = await getSignedProfilePhoto(msg.sender);
            }
            // Sign Receiver Profile
            if (msg.receiver) {
                msg.receiver.profilePhoto = await getSignedProfilePhoto(msg.receiver);
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
        const myId = req.user._id.toString();

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
        const myId = req.user._id.toString(); // Use ObjectId in aggregation if needed
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
                    // profilePhoto: '$userInfo.profilePhoto', // Removed, processed manually
                    photos: '$userInfo.photos',
                    avatar: '$userInfo.avatar',
                    auth_provider: '$userInfo.auth_provider',
                    lastMessage: 1,
                    lastMessageAt: 1,
                    unreadCount: 1
                }
            },
            { $sort: { lastMessageAt: -1 } }
        ];

        const conversations = await Chat.aggregate(pipeline);

        // Process and Sign Photos
        const processedConversations = await Promise.all(conversations.map(async (conv) => {
            // Construct a mini user object for the helper
            const userObj = {
                photos: conv.photos,
                avatar: conv.avatar,
                auth_provider: conv.auth_provider,
                profilePhoto: null // aggregate didn't protect it, but we can if we want.
            };

            conv.profilePhoto = await getSignedProfilePhoto(userObj);

            // Cleanup internal fields
            delete conv.photos;
            delete conv.avatar;
            delete conv.auth_provider;

            return conv;
        }));

        res.status(200).json({ success: true, data: processedConversations });

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

        const chatBucketName = process.env.AWS_BUCKET_NAME;

        logger.info(`Uploading File: ${req.file.originalname} (${req.file.mimetype}, ${req.file.size} bytes)`);

        const result = await uploadToS3(req.file, 'weedingzon/chat', s3Client, chatBucketName);
        logger.info(`Upload Success: ${result.Location}`);

        // Generate a signed URL for immediate use
        const signedUrl = await getSignedFileUrl(result.Key, s3Client, chatBucketName);

        res.status(200).json({ success: true, url: signedUrl });
    } catch (error) {
        logger.error('Chat Upload Error', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Server Error: ' + error.message });
    }
};
