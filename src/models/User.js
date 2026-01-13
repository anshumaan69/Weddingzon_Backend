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
            enum: ['user', 'bride', 'groom', 'vendor', 'franchise'],
            default: 'user',
        },
        admin_role: {
            type: String,
            enum: ['super_admin', 'admin'],
            default: null,
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

        // --- Preferences (Future Proofing) ---
        property_types: [String],
        land_types: [String],
        land_area: { type: String },
        house_types: [String],
        business_types: [String],
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
