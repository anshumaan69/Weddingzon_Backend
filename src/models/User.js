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
            enum: ['pending_payment', 'pending_approval', 'active', 'rejected', null, ''],
            default: null,
        },
        franchise_details: {
            business_name: { type: String },
            gst_number: { type: String },
            business_address: { type: String },
            city: { type: String },
            state: { type: String },
            pincode: { type: String },
        },
        vendor_status: {
            type: String,
            enum: ['pending_approval', 'active', 'rejected', null, ''],
            default: null,
        },
        vendor_details: {
            business_name: { type: String },
            service_type: { type: String }, // e.g., 'Catering', 'Photography'
            business_address: { type: String },
            city: { type: String },
            state: { type: String },
            description: { type: String },
            price_range: { type: String }, // e.g. '$$-$$$'
            experience_years: { type: Number },
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
        blockedUsers: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }],
        reports: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Report'
        }],
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
        // coverPhoto removed
        // --- Basic Details ---
        gender: { type: String, enum: ['Male', 'Female', 'Other'] },
        created_for: { type: String },
        height: { type: String },
        weight: { type: String }, // New
        marital_status: { type: String },
        mother_tongue: { type: String },
        disability: { type: String, default: 'None' },
        aadhar_number: { type: String },
        blood_group: { type: String },

        // --- Astro Details ---
        manglik_status: { type: String, enum: ['Manglik', 'Non-Manglik', 'Anshik Manglik', "Don't Know"], default: "Don't Know" },
        time_of_birth: { type: String },
        place_of_birth: { type: String },

        // --- Location ---
        country: { type: String },
        state: { type: String },
        city: { type: String },

        // --- Family ---
        father_name: { type: String, trim: true }, // [NEW]
        mother_name: { type: String, trim: true }, // [NEW]
        father_status: { type: String },
        mother_status: { type: String },
        father_occupation: { type: String }, // [NEW]
        mother_occupation: { type: String }, // [NEW]
        brothers: { type: Number, default: 0 },
        sisters: { type: Number, default: 0 },
        live_with_family: { type: String, enum: ['Yes', 'No'] }, // [NEW]
        family_status: { type: String },
        family_type: { type: String },
        family_values: { type: String },
        annual_income: { type: String }, // Family Income
        family_location: { type: String },

        // --- Education & Career ---
        highest_education: { type: String },
        college_name: { type: String }, // [NEW]
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
        property_possession_type: { type: String, enum: ['Self-acquired', 'Ancestral', 'Multiple'] }, // [NEW]
        land_types: [String],
        land_area: { type: Number },
        land_area_range: { type: String }, // [NEW] Optional text range if number isn't exact
        house_types: [String],
        business_types: [String],

        // --- Added Personal ---
        disability_type: { type: String }, // [NEW]
        disability_description: { type: String }, // [NEW]
        complexion: { type: String, enum: ['Fair', 'Wheatish', 'Dark'] }, // [NEW] (Mapping for 'Appearance')
        photos: {
            type: [{
                url: { type: String, required: true },
                blurredUrl: { type: String }, // For restricted access (S3)
                key: { type: String },        // S3 Key for deletion
                publicId: { type: String },   // Deprecated (Cloudinary) - Keep for backward compat temporarily
                isProfile: { type: Boolean, default: false },
                // isCover removed
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
// Encrypt password using bcrypt
userSchema.pre('save', async function () {
    if (!this.isModified('password')) {
        return;
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
