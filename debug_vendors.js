const mongoose = require('mongoose');
const User = require('./src/models/User');
require('dotenv').config();

const vendorIds = [
    "6975ecc7193efc3298c8fcdd",
    "697838876874d04286f4742e",
    "697a5c1e3f04733cbbb188fa",
    "697bc0248e28d3ed30ccd494",
    "697bdd038e28d3ed30ccdcb2"
];

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('--- VENDOR DEBUG ---');

        const users = await User.find({ _id: { $in: vendorIds } });

        users.forEach(u => {
            console.log(`\nID: ${u._id}`);
            console.log(`Username: ${u.username}`);
            console.log(`Role: ${u.role}`);
            console.log(`Status (account): ${u.status}`);
            console.log(`Vendor Status: ${u.vendor_status}`);
            console.log(`Profile Complete: ${u.is_profile_complete}`);
            console.log(`Profile Photo: ${!!u.profilePhoto}`);
            console.log(`Photos Count: ${u.photos ? u.photos.length : 0}`);
        });

        console.log('\n--- END DEBUG ---');
        process.exit();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

run();
