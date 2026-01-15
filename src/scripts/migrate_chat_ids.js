const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Chat = require('../models/Chat');

// Load env vars
dotenv.config();

const migrate = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const chats = await Chat.find({ conversationId: { $exists: false } });
        console.log(`Found ${chats.length} chats without conversationId`);

        let count = 0;
        for (const chat of chats) {
            const senderId = chat.sender.toString();
            const receiverId = chat.receiver.toString();
            const conversationId = [senderId, receiverId].sort().join('_');

            chat.conversationId = conversationId;
            await chat.save();
            count++;
            if (count % 100 === 0) console.log(`Processed ${count} chats...`);
        }

        console.log(`Migration Complete. Updated ${count} records.`);
        process.exit(0);
    } catch (error) {
        console.error('Migration Error:', error);
        process.exit(1);
    }
};

migrate();
