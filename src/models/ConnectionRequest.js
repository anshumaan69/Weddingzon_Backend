const mongoose = require('mongoose');

const connectionRequestSchema = new mongoose.Schema(
    {
        requester: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        recipient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'rejected'],
            default: 'pending',
        },
    },
    {
        timestamps: true,
    }
);

// Ensure unique request per pair
connectionRequestSchema.index({ requester: 1, recipient: 1 }, { unique: true });

// Performance Optimization Indexes
connectionRequestSchema.index({ requester: 1, status: 1 });
connectionRequestSchema.index({ recipient: 1, status: 1 });

module.exports = mongoose.model('ConnectionRequest', connectionRequestSchema);
