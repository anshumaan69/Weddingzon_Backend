const mongoose = require('mongoose');

const filterConfigSchema = new mongoose.Schema({
    label: {
        type: String,
        required: true,
        trim: true
    },
    key: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },
    type: {
        type: String,
        enum: ['text', 'number', 'select', 'range', 'checkbox', 'date'],
        required: true
    },
    options: {
        type: [String], // Only for 'select' or 'checkbox'
        default: []
    },
    order: {
        type: Number,
        default: 0
    },
    section: {
        type: String,
        default: 'Other',
        enum: ['Basic', 'Location', 'Family', 'Education', 'Religious', 'Lifestyle', 'Contact', 'Property', 'Other']
    },
    isVisible: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// Ensure proper sorting by order
filterConfigSchema.index({ order: 1 });

module.exports = mongoose.model('FilterConfig', filterConfigSchema);
