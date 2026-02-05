const User = require('../models/User');
const Cost = require('../models/Cost');
const PhotoAccessRequest = require('../models/PhotoAccessRequest');
const { sendPushNotification } = require('../services/notification.service');
const logger = require('../utils/logger');

// @desc    Get all users (with pagination, search, sort, filter)
// @route   GET /api/admin/users
// @access  Private/Admin
exports.getUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const roleFilter = req.query.role || 'all';
        const sortBy = req.query.sortBy || 'created_at';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

        const query = {};

        // Search Logic (Name or Email/Phone)
        if (search) {
            query.$or = [
                { first_name: { $regex: search, $options: 'i' } },
                { last_name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { username: { $regex: search, $options: 'i' } },
            ];
        }

        // Filter Logic
        if (roleFilter !== 'all') {
            if (roleFilter === 'admin' || roleFilter === 'superadmin' || roleFilter === 'super_admin') {
                const targetRole = (roleFilter === 'superadmin') ? 'super_admin' : roleFilter;
                query.admin_role = targetRole;
            } else {
                query.role = roleFilter;
            }
        }

        // Sort Logic
        const sortOptions = { [sortBy]: sortOrder };

        const totalUsers = await User.countDocuments(query);
        const users = await User.find(query)
            .sort(sortOptions)
            .skip((page - 1) * limit)
            .limit(limit)
            .select('-password'); // Exclude sensitive info if any

        res.status(200).json({
            success: true,
            data: users,
            pagination: {
                total: totalUsers,
                page,
                limit,
                pages: Math.ceil(totalUsers / limit),
            },
        });
    } catch (error) {
        logger.error('Admin Get Users Error', { admin: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get Vendors (Pending/Active/Rejected)
// @route   GET /api/admin/vendors
// @access  Private/Admin
exports.getVendors = async (req, res) => {
    try {
        const { status = 'pending_approval', page = 1, limit = 10, search = '' } = req.query;
        const query = { role: 'vendor', vendor_status: status };

        if (search) {
            query.$or = [
                { 'vendor_details.business_name': { $regex: search, $options: 'i' } },
                { first_name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const vendors = await User.find(query)
            .sort({ created_at: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .select('-password');

        const count = await User.countDocuments(query);

        res.status(200).json({
            success: true,
            data: vendors,
            totalPages: Math.ceil(count / limit),
            currentPage: Number(page),
            totalVendors: count
        });

    } catch (error) {
        logger.error('Get Vendors Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Update Vendor Status (Approve/Reject)
// @route   PATCH /api/admin/vendors/:id/status
// @access  Private/Admin
exports.updateVendorStatus = async (req, res) => {
    try {
        const { status } = req.body; // 'active', 'rejected'
        const { id } = req.params;

        // Find user
        const vendor = await User.findById(id);
        if (!vendor || vendor.role !== 'vendor') {
            return res.status(404).json({ message: 'Vendor not found' });
        }

        vendor.vendor_status = status;

        // If approving, also set main account status to active if it wasn't
        if (status === 'active') {
            vendor.status = 'active';
        }

        await vendor.save();

        logger.info(`Vendor ${id} status updated to ${status} by ${req.user.username}`);
        res.status(200).json({ success: true, message: `Vendor ${status} successfully`, data: vendor });

    } catch (error) {
        logger.error('Update Vendor Status Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get Emails by Role (For Bulk Email)
// @route   GET /api/admin/emails
// @access  Private/Admin
exports.getEmails = async (req, res) => {
    try {
        const { role } = req.query;
        const query = { status: 'active' }; // Only active users

        if (role && role !== 'all') {
            if (role === 'admin' || role === 'superadmin' || role === 'super_admin') {
                const targetRole = (role === 'superadmin') ? 'super_admin' : role;
                query.admin_role = targetRole;
            } else {
                query.role = role;
            }
        }

        const users = await User.find(query).select('email');
        const emails = users.map(u => u.email).filter(e => e); // Filter out null/undefined

        res.status(200).json({ success: true, count: emails.length, data: emails });
    } catch (error) {
        logger.error('Admin Get Emails Error', { admin: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get User Details (Admin View)
// @route   GET /api/admin/users/:id
// @access  Private/Admin
exports.getUserDetails = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({ success: true, data: user });
    } catch (error) {
        logger.error('Admin Get User Details Error', { admin: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get System Stats
// @route   GET /api/admin/stats
// @access  Private/Admin
exports.getStats = async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();

        // Mock Revenue for now (or calculate from Payment model if it exists)
        // Since we don't have a Payment model visible yet, we'll static/random it or set 0
        const totalRevenue = 150000; // Example placeholder

        // Active Users (e.g., users created in last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const activeUsers = await User.countDocuments({ created_at: { $gte: thirtyDaysAgo } });

        res.status(200).json({
            success: true,
            totalUsers,
            totalRevenue,
            totalUsers,
            totalRevenue,
            activeUsers,
            suspendedUsers: await User.countDocuments({ status: 'suspended' }),
            bannedUsers: await User.countDocuments({ status: 'banned' })
        });
    } catch (error) {
        logger.error('Admin Get Stats Error', { admin: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get All Costs
// @route   GET /api/admin/cost
// @access  Private/Admin
exports.getCosts = async (req, res) => {
    try {
        const costs = await Cost.find().sort({ date: -1 });
        res.status(200).json({ success: true, data: costs });
    } catch (error) {
        console.error('Get Costs Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

exports.addCost = async (req, res) => {
    try {
        const cost = await Cost.create(req.body);
        res.status(201).json({ success: true, data: cost });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
}

// @desc    Get Photo Access Requests
// @route   GET /api/admin/photo-access/requests
// @access  Private/Admin
exports.getPhotoAccessRequests = async (req, res) => {
    try {
        // Populate requester and target user details
        const requests = await PhotoAccessRequest.find()
            .populate('requester', 'first_name last_name email username profilePhoto')
            .populate('targetUser', 'first_name last_name username profilePhoto')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        logger.error('Admin Get Photo Requests Error', { admin: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Update Photo Access Request Status
// @route   PATCH /api/admin/photo-access/requests/:id
// @access  Private/Admin
exports.updatePhotoAccessStatus = async (req, res) => {
    try {
        const { status } = req.body; // 'granted' or 'rejected'

        if (!['granted', 'rejected'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const request = await PhotoAccessRequest.findById(req.params.id);

        if (!request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        request.status = status;
        request.reviewedBy = req.user._id;

        if (status === 'granted') {
            request.grantedAt = Date.now();
            logger.info(`Photo Request Granted`, { admin: req.user.username, request: request._id });
        } else {
            request.rejectedAt = Date.now();
            logger.info(`Photo Request Rejected`, { admin: req.user.username, request: request._id });
        }

        await request.save();

        res.status(200).json({ success: true, data: request });
    } catch (error) {
        logger.error('Update Photo Access Error', { admin: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Update User Status (Suspend/Ban/Active)
// @route   PATCH /api/admin/users/:id/status
// @access  Private/Admin
exports.updateUserStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        user.status = status;
        if (status === 'banned') {
            const date = new Date();
            date.setDate(date.getDate() + 30); // Default ban 30 days
            user.banExpiresAt = date;
        } else {
            user.banExpiresAt = null;
        }

        await user.save();
        logger.info(`User Status Updated: ${user.username} -> ${status}`, { admin: req.user.username });
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        logger.error('Update User Status Error', { admin: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Delete User
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await user.deleteOne();
        logger.warn(`User Deleted: ${user.username}`, { admin: req.user.username });
        res.status(200).json({ success: true, message: 'User deleted' });
    } catch (error) {
        logger.error('Delete User Error', { admin: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Update User Role
// @route   PATCH /api/admin/users/:id/role
// @access  Private/Admin
exports.updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // If promoting to admin
        if (role === 'admin') {
            user.admin_role = 'admin';
            // We don't necessarily change the main 'role' (e.g. bride/groom should stay bride/groom but have admin access?)
            // Or do we?
            // Existing logic seems to treat 'role' as the primary designator.
            // Let's set both for compatibility if needed, but per recent changes admin_role is key.
            // However, the frontend sends 'admin' as the role string.
            // For now, let's set admin_role.
        } else if (role === 'user') {
            user.admin_role = null;
        }

        // Also update the main role field for display purposes if that's what the UI expects
        // user.role = role; // Wait, User model enum for role doesn't have 'admin' anymore?
        // Let's check User model again. 
        // User model role enum: ['user', 'bride', 'groom', 'vendor', 'franchise']
        // Wait, the UI passes 'admin'. This might fail validation if I set user.role = 'admin'.
        // BUT, admin_role is what matters for access.

        // Let's just update admin_role based on the request.

        await user.save();
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        console.error('Update User Role Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Send Push Notification (Broadcast or Single)
// @route   POST /api/admin/send-push
// @access  Private/Admin
exports.sendPush = async (req, res) => {
    try {
        const { title, body, userId } = req.body;

        if (!title || !body) {
            return res.status(400).json({ message: 'Title and Body are required' });
        }

        let targetUserIds = [];

        if (userId) {
            // Target specific user
            targetUserIds = [userId];
        } else {
            // Broadcast: Fetch all users having FCM tokens
            const users = await User.find({
                fcmTokens: { $exists: true, $not: { $size: 0 } }
            }).select('_id');

            targetUserIds = users.map(u => u._id);
        }

        if (targetUserIds.length > 0) {
            // Send asynchronously to not block response
            sendPushNotification(targetUserIds, { title, body });
        }

        logger.info(`Admin Push Sent: "${title}" by ${req.user.username} to ${userId ? 'Single User' : 'All Users'}`);

        res.status(200).json({
            success: true,
            message: userId ? 'Notification sent to user' : `Broadcast initiated for ${targetUserIds.length} users`
        });

    } catch (error) {
        logger.error('Admin Send Push Error', { admin: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get Franchise Requests (Pending Approval)
// @route   GET /api/admin/franchises/requests
// @access  Private/Admin
exports.getFranchiseRequests = async (req, res) => {
    try {
        const requests = await User.find({
            role: 'franchise',
            franchise_status: 'pending_approval'
        });

        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        logger.error('Get Franchise Requests Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Approve/Reject Franchise Request
// @route   PATCH /api/admin/franchises/:id/approve
// @access  Private/Admin
exports.approveFranchise = async (req, res) => {
    try {
        console.log('--- Approve Franchise Request Received ---');
        console.log('ID:', req.params.id);
        console.log('Body:', req.body);

        const { status } = req.body; // 'active' or 'rejected'
        if (!['active', 'rejected'].includes(status)) {
            console.log('Invalid Status:', status);
            return res.status(400).json({ message: 'Invalid status' });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            console.log('User not found by ID:', req.params.id);
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.role !== 'franchise') {
            console.log('User is not franchise. Role:', user.role);
            return res.status(404).json({ message: 'Franchise user not found (Role mismatch)' });
        }

        console.log('Current Status (Before):', user.franchise_status);
        user.franchise_status = status;

        // Log validation errors if any (try/catch around save specifically?)
        // No, main catch handles it. But let's log specifically before saving.
        console.log('Attempting to save new status:', status);

        const savedUser = await user.save();
        console.log('Save completed. New Status (After):', savedUser.franchise_status);

        logger.info(`Franchise ${user.username} status updated to ${status}`);
        res.status(200).json({ success: true, message: `Franchise ${status}` });

    } catch (error) {
        console.error('CRITICAL: Approve Franchise Save Failed:', error);
        if (error.name === 'ValidationError') {
            console.error('Validation Details:', error.errors);
        }
        logger.error('Approve Franchise Error', { error: error.message });
        res.status(500).json({ message: 'Server Error: ' + error.message });
    }
};

exports.getReports = async (req, res) => {
    try {
        const { status } = req.query;
        const query = status ? { status } : {};

        const reports = await require('../models/Report').find(query)
            .populate('reporter', 'username first_name last_name profilePhoto')
            .populate('reportedUser', 'username first_name last_name profilePhoto')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: reports });
    } catch (error) {
        logger.error('Get Reports Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

exports.updateReportStatus = async (req, res) => {
    try {
        const { status, adminNotes } = req.body;
        const report = await require('../models/Report').findById(req.params.id);

        if (!report) {
            return res.status(404).json({ message: 'Report not found' });
        }

        if (status) report.status = status;
        if (adminNotes) report.adminNotes = adminNotes;

        await report.save();
        res.status(200).json({ success: true, data: report });
    } catch (error) {
        logger.error('Update Report Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Create a new user (Admin only)
// @route   POST /api/admin/users
// @access  Private/Admin
exports.createUser = async (req, res) => {
    try {
        const {
            username, email, phone, password,
            first_name, last_name, role,
            gender, dob, religion, community, city,
            vendor_details, franchise_details
        } = req.body;

        // Basic validation
        if (!username || (!email && !phone) || !password || !role) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Check for existing user
        const existingUser = await User.findOne({
            $or: [
                { username },
                { email: email || undefined },
                { phone: phone || undefined }
            ]
        });

        if (existingUser) {
            return res.status(400).json({ message: 'User with this username, email or phone already exists' });
        }

        // Prepare User Data
        const userData = {
            username,
            email,
            phone,
            password,
            first_name,
            last_name,
            role,
            gender,
            dob,
            religion,
            community,
            city,
            is_phone_verified: true, // Manual admin creation skips verify
            is_profile_complete: true,
            status: 'active'
        };

        // Role Specific Logic
        if (role === 'vendor') {
            userData.vendor_status = 'active';
            userData.vendor_details = vendor_details;
        } else if (role === 'franchise') {
            userData.franchise_status = 'active';
            userData.franchise_details = franchise_details;
        } else if (role === 'admin') {
            userData.admin_role = 'admin';
        }

        const user = await User.create(userData);

        logger.info(`Admin ${req.user.username} created new user: ${user.username} (Role: ${role})`);

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: {
                _id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                status: user.status
            }
        });

    } catch (error) {
        logger.error('Admin Create User Error', { admin: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error: ' + error.message });
    }
};
