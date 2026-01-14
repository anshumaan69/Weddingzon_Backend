const Chat = require('../models/Chat');
const User = require('../models/User');
const logger = require('../utils/logger');

// @desc    Get Chat History with a specific user
// @route   GET /api/chat/history/:userId
// @access  Private
exports.getChatHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const myId = req.user.id;

        const messages = await Chat.find({
            $or: [
                { sender: myId, receiver: userId },
                { sender: userId, receiver: myId }
            ]
        })
            .sort({ timestamp: 1 }); // Oldest first for chat window

        res.status(200).json(messages);
    } catch (error) {
        logger.error('Get Chat History Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get All Conversations (Users interaction list)
// @route   GET /api/chat/conversations
// @access  Private
exports.getConversations = async (req, res) => {
    try {
        const myId = req.user.id;

        // 1. Find all unique users I've chatted with
        // We aggregate to find distinct partners and the latest message
        const conversations = await Chat.aggregate([
            {
                $match: {
                    $or: [
                        { sender: myId }, // I sent
                        // { receiver: myId } // I received (Need to handle ObjectId casting if myId is string, usually mongoose handles it but in aggregate sometimes tricky. Assuming myId is string from middleware)
                    ]
                }
            },
            // We need to match receiver=myId separately or ensure type consistency. 
            // Better approach: Match any doc where I am sender OR receiver
        ]);

        // Optimized Aggregation
        // Group by the "other" person
        const results = await Chat.aggregate([
            {
                $match: {
                    $or: [{ sender: myId }, { receiver: myId }]
                }
            },
            {
                $sort: { timestamp: -1 }
            },
            {
                $group: {
                    _id: {
                        $cond: {
                            if: { $eq: ["$sender", myId] },
                            then: "$receiver",
                            else: "$sender"
                        }
                    },
                    lastMessage: { $first: "$message" },
                    timestamp: { $first: "$timestamp" }
                }
            },
            { $sort: { timestamp: -1 } }
        ]);

        // Populate User Details manually since aggregate doesn't return full documents
        const populatedConversations = await Promise.all(results.map(async (chat) => {
            const user = await User.findById(chat._id).select('username first_name last_name profilePhoto');
            if (!user) return null; // User might be deleted

            // Reconstruct friendly object
            return {
                _id: user._id,
                username: user.username,
                displayName: user.first_name ? `${user.first_name} ${user.last_name}` : user.username,
                profilePhoto: user.profilePhoto,
                lastMessage: chat.lastMessage,
                timestamp: chat.timestamp
            };
        }));

        res.status(200).json(populatedConversations.filter(Boolean));

    } catch (error) {
        logger.error('Get Conversations Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
