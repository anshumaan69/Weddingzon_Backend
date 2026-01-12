const express = require('express');
const router = express.Router();
const authRoutes = require('./auth.routes');

// Home Route
router.get('/', homeController.getHomePage);

// Health Check
router.get('/health', homeController.getHealthCheck);

// Auth Routes
router.use('/api/auth', authRoutes);

module.exports = router;
