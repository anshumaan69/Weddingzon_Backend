console.log('Socket: Loading jwt...');
const jwt = require('jsonwebtoken');
console.log('Socket: Loading User...');
const User = require('../models/User');
console.log('Socket: Loading Chat...');
const Chat = require('../models/Chat');
console.log('Socket: Loading Logger...');
const logger = require('../utils/logger');
console.log('Socket: Loading S3 Utils...');
const { getSignedFileUrl } = require('../utils/s3');
console.log('Socket: Loading S3 Config...');
const { s3Client } = require('../config/s3');
const { notifyUser } = require('../services/notification.service');
console.log('Socket: Imports Done');

module.exports = (io) => {
    // Middleware for Authentication
    io.use(async (socket, next) => {
        try {
            console.log('Socket Handshake Attempt:', socket.id);
            const token = socket.handshake.auth.token;
            if (!token) {
                console.log('Socket Auth Failed: No Token Provided');
                return next(new Error('Authentication error'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id).select('-password').lean();
            if (!user) {
                console.log('Socket Auth Failed: User Not Found for ID', decoded.id);
                return next(new Error('User not found'));
            }

            socket.user = user;
            next();
        } catch (error) {
            console.error('Socket Auth Middleware Error:', error.message);
            // Distinguish between expired/invalid token and other errors
            if (error.name === 'TokenExpiredError') {
                console.log('Socket Auth: Token Expired');
            } else if (error.name === 'JsonWebTokenError') {
                console.log('Socket Auth: Invalid Token');
            }
            next(new Error('Authentication error'));
        }
    });

    io.on('connection', async (socket) => {
        const userId = socket.user._id.toString(); // Ensure string
        logger.info(`Socket Connected: ${socket.user.username} (${userId})`);

        // Update User Status to Online
        await User.findByIdAndUpdate(userId, { isOnline: true });
        io.emit('user_status', { userId, status: 'online' });

        // Join user's own room (for receiving messages)
        socket.join(userId);

        // Handle Send Message
        socket.on('send_message', async (data, callback) => {
            try {
                const { receiverId, message, type, mediaUrl } = data;

                if (!receiverId) {
                    logger.warn('Socket: Missing receiverId');
                    if (typeof callback === 'function') callback({ status: 'error', error: 'Missing receiverId' });
                    return;
                }

                // Generate deterministic conversationId
                const conversationId = [userId, receiverId].sort().join('_');
                logger.info(`Processing Message: ${userId} -> ${receiverId} (Conv: ${conversationId})`);

                // Save to DB
                // Note: mediaUrl here is just the key/url from upload. 
                const newChat = await Chat.create({
                    sender: userId,
                    receiver: receiverId,
                    conversationId,
                    message,
                    type: type || 'text',
                    mediaUrl, // optional
                    read: false
                });

                logger.info(`Message Saved ID: ${newChat._id}`);

                const populatedChat = await Chat.findById(newChat._id)
                    .populate('sender', 'username profilePhoto')
                    .populate('receiver', 'username profilePhoto')
                    .lean(); // Use lean to modify

                // Sign Image URL if present (so receiver can view it immediately)
                if (populatedChat.type === 'image' && populatedChat.mediaUrl) {
                    populatedChat.mediaUrl = await getSignedFileUrl(populatedChat.mediaUrl, s3Client);
                }

                // Emit to Receiver
                io.to(receiverId).emit('receive_message', populatedChat);

                // Emit back to Sender 
                socket.emit('message_sent', populatedChat);

                // Acknowledge to Client
                if (typeof callback === 'function') {
                    // Send back the populated chat so sender gets the signed URL too
                    callback({ status: 'ok', messageId: newChat._id, data: populatedChat });
                }

                logger.info(`Events Emitted to rooms: ${receiverId} and Sender Socket`);

                // Send Push Notification (Fire & Forget)
                notifyUser(receiverId, {
                    title: `New Message from ${socket.user.first_name || socket.user.username}`,
                    body: type === 'image' ? 'Sent a photo' : message,
                    data: {
                        type: 'chat_message',
                        conversationId,
                        senderId: userId
                    }
                });

            } catch (error) {
                logger.error('Socket Send Error', { error: error.message, stack: error.stack });
                if (typeof callback === 'function') {
                    callback({ status: 'error', error: error.message });
                }
            }
        });

        // Typing Indicators
        socket.on('typing', (data) => {
            if (data.receiverId) io.to(data.receiverId).emit('user_typing', { userId });
        });

        socket.on('stop_typing', (data) => {
            if (data.receiverId) io.to(data.receiverId).emit('user_stop_typing', { userId });
        });

        socket.on('disconnect', async () => {
            logger.info(`Socket Disconnected: ${socket.user.username}`);
            // Update User Status to Offline
            const lastSeen = new Date();
            await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen });
            io.emit('user_status', { userId, status: 'offline', lastSeen });
        });
    });
};
