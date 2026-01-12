const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            unique: true,
            sparse: true,
            lowercase: true,
            trim: true,
        },
        phone: {
            type: String,
            unique: true,
            sparse: true,
        },
        auth_provider: {
            type: String,
            enum: ['google', 'local', 'google_phone'],
            default: 'local',
        },
        is_phone_verified: {
            type: Boolean,
            default: false,
        },
        is_profile_complete: {
            type: Boolean,
            default: false,
        },
        role: {
            type: String,
            enum: ['user', 'bride', 'groom', 'vendor', 'franchise', 'admin', 'superadmin'],
            default: 'user',
        },
        username: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
        },
        first_name: {
            type: String,
            trim: true,
        },
        last_name: {
            type: String,
            trim: true,
        },
        dob: {
            type: Date,
        },
        status: {
            type: String,
            enum: ['active', 'banned', 'suspended'],
            default: 'active',
        },
        banExpiresAt: {
            type: Date,
        },
        deletedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at',
        },
    }
);

module.exports = mongoose.model('User', userSchema);
