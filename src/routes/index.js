const express = require('express');
const router = express.Router();
const authRoutes = require('./auth.routes');
const homeController = require('../controllers/homeController');

// Home Route
router.get('/', homeController.getHomePage);

// Health Check
router.get('/health', homeController.getHealthCheck);

// Auth Routes
router.use('/api/auth', authRoutes);

// User/Feed Routes
const userRoutes = require('./user.routes');
router.use('/api/users', userRoutes);

// Product Routes
router.use('/api/products', require('./product.routes'));

// Upload Routes
router.use('/api/uploads', require('./upload.routes'));

// Filter Routes
router.use('/api/filters', require('./filter.routes'));

// Admin Routes
router.use('/api/admin', require('./admin.routes'));

// Franchise Routes
router.use('/api/franchise', require('./franchise.routes'));

// Connection Routes
router.use('/api/connections', require('./connection.routes'));

// Notification Routes
router.use('/api/notifications', require('./notification.routes'));

// Chat Routes
router.use('/api/chat', require('./chat.routes'));


module.exports = router;
