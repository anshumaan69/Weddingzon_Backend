const Chat = require('../models/Chat');
const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');

module.exports = (io) => {
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
        logger.info(`Socket Connected: ${socket.user.id}`);

        // Join a room specific to this user (for receiving private messages)
        socket.join(socket.user.id);

        socket.on('join_room', (room) => {
            socket.join(room);
            logger.info(`User ${socket.user.id} joined room ${room}`);
        });

        socket.on('send_message', async (data) => {
            try {
                const { receiverId, message } = data;

                // Save to Database
                const newChat = new Chat({
                    sender: socket.user.id,
                    receiver: receiverId,
                    message: message
                });
                await newChat.save();

                // Emit to receiver's room
                io.to(receiverId).emit('receive_message', {
                    _id: newChat._id,
                    sender: socket.user.id,
                    receiver: receiverId,
                    message: message,
                    timestamp: newChat.timestamp,
                    isRead: false
                });

                // Also emit back to sender (optimistic UI update details)
                socket.emit('message_sent', newChat);

            } catch (error) {
                logger.error('Socket Send Message Error', { error: error.message });
            }
        });

        socket.on('disconnect', () => {
            logger.info(`Socket Disconnected: ${socket.user.id}`);
        });
    });
};
