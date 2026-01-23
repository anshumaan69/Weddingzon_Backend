const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
        temp_phone: {
            type: String,
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
        otp: {
            type: String,
            select: false, // Don't return in queries by default
        },
        otpExpires: {
            type: Date,
            select: false,
        },
        fcmTokens: {
            type: [String],
            default: [],
            select: false // Don't expose tokens in general queries
        },
        is_profile_complete: {
            type: Boolean,
            default: false,
        },
        role: {
            type: String,
            enum: ['user', 'member', 'bride', 'groom', 'vendor', 'franchise'],
            default: 'user',
        },
        admin_role: {
            type: String,
            enum: ['super_admin', 'admin'],
            default: null,
        },
        franchise_status: {
            type: String,
            enum: ['pending_payment', 'pending_approval', 'active', 'rejected', null],
            default: null,
        },
        created_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        partner_preferences: {
            type: Map,
            of: String, // Simplified for now (e.g., 'minAge': '25', 'maxAge': '30')
            default: {},
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
        // --- Basic Details ---
        gender: { type: String, enum: ['Male', 'Female', 'Other'] },
        created_for: { type: String },
        height: { type: String },
        marital_status: { type: String },
        mother_tongue: { type: String },
        disability: { type: String, default: 'None' },
        aadhar_number: { type: String },
        blood_group: { type: String },

        // --- Location ---
        country: { type: String },
        state: { type: String },
        city: { type: String },

        // --- Family ---
        father_status: { type: String },
        mother_status: { type: String },
        brothers: { type: Number, default: 0 },
        sisters: { type: Number, default: 0 },
        family_status: { type: String },
        family_type: { type: String },
        family_values: { type: String },
        annual_income: { type: String }, // Family Income
        family_location: { type: String },

        // --- Education & Career ---
        highest_education: { type: String },
        educational_details: { type: String },
        occupation: { type: String },
        employed_in: { type: String },
        personal_income: { type: String },
        working_sector: { type: String },
        working_location: { type: String },

        // --- Religious ---
        religion: { type: String },
        community: { type: String },
        sub_community: { type: String },

        // --- Lifestyle ---
        appearance: { type: String },
        living_status: { type: String },
        physical_status: { type: String },
        eating_habits: { type: String },
        smoking_habits: { type: String },
        drinking_habits: { type: String },
        hobbies: [String],

        // --- Contact & Extra ---
        alternate_mobile: { type: String },
        suitable_time_to_call: { type: String },
        about_me: { type: String },

        // --- GeoLocation ---
        location: {
            type: {
                type: String,
                enum: ['Point'],
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                index: '2dsphere',
            },
        },

        // --- Preferences ---
        partner_preferences: {
            type: Map,
            of: String,
            default: {},
        },
        property_types: [String],
        land_types: [String],
        land_area: { type: Number },
        house_types: [String],
        business_types: [String],
        photos: {
            type: [{
                url: { type: String, required: true },
                blurredUrl: { type: String }, // For restricted access (S3)
                key: { type: String },        // S3 Key for deletion
                publicId: { type: String },   // Deprecated (Cloudinary) - Keep for backward compat temporarily
                isProfile: { type: Boolean, default: false },
                order: { type: Number, default: 0 },
                uploadedAt: { type: Date, default: Date.now }
            }],
            validate: [
                {
                    validator: function (v) {
                        return v.length <= 10;
                    },
                    message: 'Maximum 10 photos allowed',
                },
            ],
            default: [],
        },
        deletedAt: {
            type: Date,
            default: null,
        },
        // --- Auth ---
        password: {
            type: String,
            select: false, // Don't return by default
        },
    },
    {
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at',
        },
    }
);

// Encrypt password using bcrypt
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Indexes for Performance
userSchema.index({ status: 1, _id: -1 }); // Critical for Feed Pagination
// userSchema.index({ username: 1 }); // Already indexed by unique: true
// userSchema.index({ email: 1 }); // Already indexed by unique: true
// userSchema.index({ phone: 1 }); // Already indexed by unique: true
userSchema.index({ 'photos.isProfile': 1 }); // Finding profile photos
userSchema.index({ location: '2dsphere' }); // GeoSpatial Index for Nearby Search

module.exports = mongoose.model('User', userSchema);
