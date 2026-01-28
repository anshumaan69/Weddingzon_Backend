const mongoose = require('mongoose');

const profileViewSchema = new mongoose.Schema({
    viewer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    profileOwner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    viewedAt: {
        type: Date,
        default: Date.now
    },
    isRead: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

// Index for efficient querying and preventing duplicates (if we want unique per day logic)
// Compound index to quickly find if X viewed Y recently
profileViewSchema.index({ viewer: 1, profileOwner: 1, viewedAt: -1 });
profileViewSchema.index({ profileOwner: 1, viewedAt: -1 });

module.exports = mongoose.model('ProfileView', profileViewSchema);
