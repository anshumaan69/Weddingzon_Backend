const express = require('express');
const router = express.Router();
const homeController = require('../controllers/homeController');

// Home Route
router.get('/', homeController.getHomePage);

// Health Check
router.get('/health', homeController.getHealthCheck);

module.exports = router;
