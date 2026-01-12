require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const User = require('../src/models/User');

const createTestUser = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // Generate random suffix to ensure uniqueness
        const suffix = Math.floor(1000 + Math.random() * 9000);

        const userData = {
            email: `test.user${suffix}@example.com`,
            phone: `+9198765${suffix}`,
            username: `testuser${suffix}`,
            first_name: 'Test',
            last_name: 'User',
            auth_provider: 'local', // or 'google' if simulating
            role: 'groom', // or 'bride'
            dob: new Date('1995-01-01'),
            gender: 'Male',
            religion: 'Hindu',
            mother_tongue: 'Hindi',
            marital_status: 'Never Married',
            height: '5ft 10in',

            // Location
            country: 'India',
            state: 'Maharashtra',
            city: 'Mumbai',

            // Profile Completion
            about_me: 'This is a test user created via script.',
            is_profile_complete: true,
            is_phone_verified: true,

            // Feed/Photos
            photos: [],
            profilePhoto: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3'
        };

        const user = new User(userData);
        await user.save();

        console.log('✅ User created successfully!');
        console.log('-----------------------------------');
        console.log('Email:', userData.email);
        console.log('Phone:', userData.phone);
        console.log('Username:', userData.username);
        console.log('ID:', user._id);
        console.log('-----------------------------------');

        // Check for duplicates
    } catch (error) {
        console.error('Error creating user:', error);
    } finally {
        await mongoose.disconnect();
    }
};

createTestUser();
