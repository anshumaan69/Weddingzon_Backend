const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const sendEmail = async ({ to, subject, text, html }) => {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            logger.warn('Email credentials not set. Logging email instead.');
            logger.info(`[MOCK EMAIL] To: ${to}, Subject: ${subject}, Text: ${text}`);
            return;
        }

        const transporter = nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE || 'gmail', // Default to gmail
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
            to,
            subject,
            text,
            html,
        });

        logger.info(`Email sent: ${info.messageId}`);
    } catch (error) {
        logger.error('Email Send Error', { error: error.message });
    }
};

module.exports = { sendEmail };
