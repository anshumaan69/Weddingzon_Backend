const express = require('express');
const router = express.Router();
const { getUsers, getStats, getReports, updateReportStatus } = require('../controllers/admin.controller');
const { protect, admin } = require('../middlewares/authMiddleware');

router.use(protect);
router.use(admin);

router.get('/users', getUsers);
router.get('/emails', require('../controllers/admin.controller').getEmails);
router.get('/users/:id', require('../controllers/admin.controller').getUserDetails);
router.patch('/users/:id/status', require('../controllers/admin.controller').updateUserStatus);
router.patch('/users/:id/role', require('../controllers/admin.controller').updateUserRole);
router.delete('/users/:id', require('../controllers/admin.controller').deleteUser);

router.get('/stats', getStats);

router.get('/cost', require('../controllers/admin.controller').getCosts);
router.post('/cost', require('../controllers/admin.controller').addCost);

router.get('/photo-access/requests', require('../controllers/admin.controller').getPhotoAccessRequests);
router.patch('/photo-access/requests/:id', require('../controllers/admin.controller').updatePhotoAccessStatus);

// Send Push Notification
router.post('/send-push', require('../controllers/admin.controller').sendPush);

// Franchise Management
router.get('/franchises/requests', require('../controllers/admin.controller').getFranchiseRequests);
router.patch('/franchises/:id/approve', require('../controllers/admin.controller').approveFranchise);

// Report Management
router.get('/reports', getReports);
router.patch('/reports/:id', updateReportStatus);

module.exports = router;
