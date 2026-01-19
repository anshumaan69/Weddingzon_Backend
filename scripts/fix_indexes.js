require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

const fixIndexes = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        console.log('Syncing Indexes for User model...');
        // This will drop indexes that don't match the schema and create new ones
        const result = await User.syncIndexes();
        console.log('Indexes Synced:', result);

        console.log('Verifying Indexes...');
        const indexes = await User.collection.getIndexes();
        console.log('Current Indexes:', indexes);

        process.exit(0);
    } catch (error) {
        console.error('Error fixing indexes:', error);
        process.exit(1);
    }
};

fixIndexes();
