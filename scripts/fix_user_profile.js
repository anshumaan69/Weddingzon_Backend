require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const User = require('../src/models/User');

const emailToFix = process.argv[2]; // Get email from command line arg

if (!emailToFix) {
    console.error('Please provide an email address as an argument.');
    console.log('Usage: node scripts/fix_user_profile.js your.email@gmail.com');
    process.exit(1);
}

const fixUserProfile = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const user = await User.findOne({ email: emailToFix });

        if (!user) {
            console.error('User not found with email:', emailToFix);
            return;
        }

        console.log('Found user:', user.first_name, user.last_name);

        // Update fields to make profile complete
        user.is_profile_complete = true;
        user.is_phone_verified = true;

        // Ensure required fields are present if missing
        if (!user.dob) user.dob = new Date('1995-01-01');
        if (!user.gender) user.gender = 'Male';
        if (!user.religion) user.religion = 'Hindu';
        if (!user.about_me) user.about_me = 'Profile force-completed via script.';

        // Ensure username exists
        if (!user.username) {
            const randomSuffix = Math.floor(1000 + Math.random() * 9000);
            user.username = `${user.email.split('@')[0]}${randomSuffix}`;
        }

        await user.save();

        console.log('✅ User profile updated to COMPLETE!');
        console.log('You can now log in and skip onboarding.');

    } catch (error) {
        console.error('Error updating user:', error);
    } finally {
        await mongoose.disconnect();
    }
};

fixUserProfile();
