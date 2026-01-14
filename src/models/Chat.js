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
    message: {
        type: String,
        required: function () { return !this.media; } // Message is optional if media is present
    },
    media: {
        url: { type: String },
        type: { type: String, enum: ['image', 'video', 'audio', 'file'] },
        fileName: { type: String }
    },
    isRead: {
        type: Boolean,
        default: false
    },
    reactions: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        emoji: { type: String }
    }],
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Index for quick retrieval of conversation history
chatSchema.index({ sender: 1, receiver: 1, timestamp: -1 });
chatSchema.index({ receiver: 1, sender: 1, timestamp: -1 });

module.exports = mongoose.model('Chat', chatSchema);
