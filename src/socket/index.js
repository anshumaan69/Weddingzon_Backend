const Chat = require('../models/Chat');
const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

module.exports = async (io) => {
    // --- Redis Adapter Setup ---
    if (process.env.REDIS_URL) {
        try {
            const pubClient = createClient({ url: process.env.REDIS_URL });
            const subClient = pubClient.duplicate();

            await Promise.all([pubClient.connect(), subClient.connect()]);

            io.adapter(createAdapter(pubClient, subClient));
            logger.info('Redis Adapter connected to Socket.IO');
        } catch (error) {
            logger.error('Redis Adapter Connection Error', { error: error.message });
            // Continue without Redis (InMemory)
        }
    }

    // Middleware for authentication
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('Authentication error'));
            }

            // Verify JWT
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded; // Attach user info to socket
            next();
        } catch (err) {
            next(new Error('Authentication error'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.user.id;
        logger.info(`Socket Connected: ${userId}`);

        // Join a room specific to this user
        socket.join(userId);

        // Broadcast user online status
        socket.broadcast.emit('user_status', { userId, status: 'online' });

        socket.on('join_room', (room) => {
            socket.join(room);
            logger.info(`User ${userId} joined room ${room}`);
        });

        // --- Typing Indicators ---
        socket.on('typing_start', (data) => {
            const { receiverId } = data;
            io.to(receiverId).emit('typing_start', { senderId: userId });
        });

        socket.on('typing_end', (data) => {
            const { receiverId } = data;
            io.to(receiverId).emit('typing_end', { senderId: userId });
        });

        // --- Read Receipts ---
        socket.on('message_read', async (data) => {
            const { messageId, senderId } = data;
            try {
                await Chat.findByIdAndUpdate(messageId, { isRead: true });
                io.to(senderId).emit('message_read', { messageId, readerId: userId });
            } catch (error) {
                logger.error('Message Read Update Error', error);
            }
        });

        socket.on('send_message', async (data) => {
            try {
                const { receiverId, message, media } = data;

                // Save to Database
                const newChat = new Chat({
                    sender: userId,
                    receiver: receiverId,
                    message: message, // Can be empty if media is present
                    media: media
                });
                await newChat.save();

                const messageData = {
                    _id: newChat._id,
                    sender: userId,
                    receiver: receiverId,
                    message: message,
                    media: media,
                    timestamp: newChat.timestamp,
                    isRead: false
                };

                // Emit to receiver's room
                io.to(receiverId).emit('receive_message', messageData);

                // Also emit back to sender (functionally 'ack', ensures data consistency)
                socket.emit('message_sent', messageData);

            } catch (error) {
                logger.error('Socket Send Message Error', { error: error.message });
            }
        });

        socket.on('disconnect', () => {
            logger.info(`Socket Disconnected: ${userId}`);
            // Broadcast offline status
            socket.broadcast.emit('user_status', { userId, status: 'offline' });
        });
    });
};
