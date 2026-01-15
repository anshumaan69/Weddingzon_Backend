const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Chat = require('../models/Chat');
const logger = require('../utils/logger');

module.exports = (io) => {
    // Middleware for Authentication
    io.use(async (socket, next) => {
        try {
            console.log('Socket Handshake Attempt:', socket.id);
            const token = socket.handshake.auth.token;
            if (!token) {
                console.log('Socket Auth Failed: No Token');
                return next(new Error('Authentication error'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password').lean();
            if (!req.user) return next(new Error('User not found'));

            socket.user = req.user;
            next();
        } catch (error) {
            console.error('Socket Auth Middleware Error:', error);
            next(new Error('Authentication error'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.user._id.toString(); // Ensure string
        logger.info(`Socket Connected: ${socket.user.username} (${userId})`);

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
                    .populate('receiver', 'username profilePhoto');

                // Emit to Receiver
                io.to(receiverId).emit('receive_message', populatedChat);

                // Emit back to Sender 
                socket.emit('message_sent', populatedChat);

                // Acknowledge to Client
                if (typeof callback === 'function') {
                    callback({ status: 'ok', messageId: newChat._id });
                }

                logger.info(`Events Emitted to rooms: ${receiverId} and Sender Socket`);

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

        socket.on('disconnect', () => {
            logger.info(`Socket Disconnected: ${socket.user.username}`);
        });
    });
};
