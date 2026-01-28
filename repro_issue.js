
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const User = require('./src/models/User');

async function run() {
    try {
        console.log('Connecting to DB...');
        if (!process.env.MONGO_URI) {
            console.error('MONGO_URI is missing in .env');
            process.exit(1);
        }
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        const user = await User.findOne({ status: 'active' });
        if (!user) {
            console.log('No active user found');
            process.exit(0);
        }

        console.log(`Found user: '${user.username}' (ID: ${user._id})`);

        // Test 1: Axios to localhost
        const urlLocalhost = `http://localhost:5000/api/users/${user.username}/public-preview`;
        console.log(`\n--- Axios GET ${urlLocalhost} ---`);
        try {
            const res = await axios.get(urlLocalhost);
            console.log(`Status: ${res.status}`);
            console.log('Use data:', res.data.username);
        } catch (err) {
            console.error('Axios Error:', err.message);
            if (err.response) console.error('Response:', err.response.status, err.response.data);
        }

        // Test 2: Fetch to 127.0.0.1
        const urlIP = `http://127.0.0.1:5000/api/users/${user.username}/public-preview`;
        console.log(`\n--- Fetch GET ${urlIP} ---`);
        try {
            const res = await fetch(urlIP);
            console.log(`Status: ${res.status}`);
            if (res.ok) {
                const data = await res.json();
                console.log('Use data:', data.username);
            } else {
                console.log('Fetch Failed Status:', res.statusText);
                const text = await res.text();
                console.log('Response:', text);
            }
        } catch (err) {
            console.error('Fetch Error:', err.message);
        }

        // Test 3: Fetch to localhost
        const urlLocal = `http://localhost:5000/api/users/${user.username}/public-preview`;
        console.log(`\n--- Fetch GET ${urlLocal} ---`);
        try {
            const res = await fetch(urlLocal);
            console.log(`Status: ${res.status}`);
            if (res.ok) {
                const data = await res.json();
                console.log('Use data:', data.username);
            } else {
                console.log('Fetch Failed Status:', res.statusText);
                const text = await res.text();
                console.log('Response:', text);
            }
        } catch (err) {
            console.error('Fetch Error:', err.message);
        }

    } catch (err) {
        console.error('Script Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

run();
