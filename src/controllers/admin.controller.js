const User = require('../models/User');
const Cost = require('../models/Cost');
const PhotoAccessRequest = require('../models/PhotoAccessRequest');

// @desc    Get all users (with pagination, search, sort, filter)
// @route   GET /api/admin/users
// @access  Private/Admin
exports.getUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const roleFilter = req.query.role || 'all';
        const sortOrder = req.query.sortOrder || 'desc';

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
            query.role = roleFilter;
        }

        // Sort Logic
        const sortOptions = {};
        if (sortOrder === 'asc') sortOptions.created_at = 1;
        else sortOptions.created_at = -1;

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
                pages: Math.ceil(totalUsers / limit),
            },
        });
    } catch (error) {
        console.error('Get Users Error:', error);
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
        console.error('Get Stats Error:', error);
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
            .populate('requesterId', 'first_name last_name email')
            .populate('targetUserId', 'first_name last_name')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        console.error('Get Photo Access Requests Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};
