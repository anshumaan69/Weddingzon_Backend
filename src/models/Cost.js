const mongoose = require('mongoose');

const costSchema = new mongoose.Schema({
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    type: { type: String, enum: ['Fixed', 'Variable'], required: true },
    date: { type: Date, default: Date.now },
    description: { type: String },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Cost', costSchema);
