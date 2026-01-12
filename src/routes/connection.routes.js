const express = require('express');
const router = express.Router();
const { sendRequest, getConnectionStatus } = require('../controllers/connection.controller');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.post('/request/:recipientId', sendRequest);
router.get('/status/:userId', getConnectionStatus);

module.exports = router;
