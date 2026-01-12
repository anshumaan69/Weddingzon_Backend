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
        bio: {
            type: String,
            maxLength: 150,
            default: '',
        },
        profilePhoto: {
            type: String,
            default: null,
        },
        photos: {
            type: [{
                url: { type: String, required: true },
                publicId: { type: String, required: true },
                isProfile: { type: Boolean, default: false },
                order: { type: Number, default: 0 },
                uploadedAt: { type: Date, default: Date.now }
            }],
            validate: [
                {
                    validator: function (v) {
                        return v.length <= 5;
                    },
                    message: 'Maximum 5 photos allowed',
                },
            ],
            default: [],
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
