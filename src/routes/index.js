const express = require('express');
const router = express.Router();
const authRoutes = require('./auth.routes');

// Home Route
router.get('/', homeController.getHomePage);

// Health Check
router.get('/health', homeController.getHealthCheck);

// Auth Routes
router.use('/api/auth', authRoutes);

// User/Feed Routes
const userRoutes = require('./user.routes');
router.use('/api/users', userRoutes);

module.exports = router;
