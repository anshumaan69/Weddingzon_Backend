const express = require('express');
const router = express.Router();
const { getUsers, getStats } = require('../controllers/admin.controller');
const { protect, admin } = require('../middlewares/authMiddleware');

router.use(protect);
router.use(admin);

router.get('/users', getUsers);

router.get('/stats', getStats);

router.get('/cost', require('../controllers/admin.controller').getCosts);
router.post('/cost', require('../controllers/admin.controller').addCost);

router.get('/photo-access/requests', require('../controllers/admin.controller').getPhotoAccessRequests);

module.exports = router;
