const mongoose = require('mongoose');
const User = require('./src/models/User');
const Product = require('./src/models/Product');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('--- START DEBUG ---');

        const distinctVendors = await Product.distinct('vendor', { isActive: true });
        console.log(`Vendor IDs from Products: ${distinctVendors.length}`);

        if (distinctVendors.length > 0) {
            const sampleVendorId = distinctVendors[0];
            console.log(`Checking Vendor ID: ${sampleVendorId}`);

            const user = await User.findById(sampleVendorId);
            if (!user) {
                console.log('User NOT FOUND in DB');
            } else {
                console.log('User Found:');
                console.log(`- username: ${user.username}`);
                console.log(`- status: ${user.status} (Expected: active)`);
                console.log(`- vendor_status: ${user.vendor_status}`);
                console.log(`- is_profile_complete: ${user.is_profile_complete} (Expected: true)`);
                console.log(`- role: ${user.role}`);
                console.log(`- _id: ${user._id}`);
            }
        } else {
            console.log('No Active Products found linked to any vendor.');
        }

        console.log('--- END DEBUG ---');
        process.exit();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

run();
