const mongoose = require('mongoose');
require('dotenv').config();

const userSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.model('User', userSchema);

const checkUser = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const memberId = '697311fa2c4400aca5ed1beb'; // The ID from your URL
        const user = await User.findById(memberId).lean();

        console.log('--- USER DUMP ---');
        console.log('ID:', user._id);
        console.log('Username:', user.username);
        console.log('Created By:', user.created_by);
        console.log('Partner Preferences (Raw):', user.partner_preferences);

        if (user.partner_preferences) {
            console.log('Is Array?', Array.isArray(user.partner_preferences));
            console.log('Keys:', Object.keys(user.partner_preferences));
        }

        process.exit();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

checkUser();
