const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    conversationId: {
        type: String,
        required: true,
        index: true
    },
    message: {
        type: String,
        trim: true
    },
    type: {
        type: String,
        enum: ['text', 'image'],
        default: 'text'
    },
    mediaUrl: {
        type: String // For images
    },
    read: {
        type: Boolean,
        default: false
    },
    readAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Optimized Indexes for Scalability
chatSchema.index({ conversationId: 1, createdAt: -1 }); // Fast history fetch
chatSchema.index({ receiver: 1, read: 1 }); // Fast unread count fetch
chatSchema.index({ sender: 1, createdAt: -1 }); // Fast sidebar fetch (sender part)
chatSchema.index({ receiver: 1, createdAt: -1 }); // Fast sidebar fetch (receiver part)

module.exports = mongoose.model('Chat', chatSchema);
