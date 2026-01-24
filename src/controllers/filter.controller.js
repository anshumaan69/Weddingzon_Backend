const FilterConfig = require('../models/FilterConfig');
const logger = require('../utils/logger');

// @desc    Get All Visible Filters (Public/User)
// @route   GET /api/filters
// @access  Public
exports.getFilters = async (req, res) => {
    try {
        const filters = await FilterConfig.find({ isVisible: true }).sort({ order: 1 }).lean();
        res.status(200).json({ success: true, data: filters });
    } catch (error) {
        logger.error('Get Filters Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get All Filters (Admin)
// @route   GET /api/filters/admin
// @access  Private (Admin)
exports.getAllFilters = async (req, res) => {
    try {
        const filters = await FilterConfig.find({}).sort({ order: 1, section: 1 }).lean();
        res.status(200).json({ success: true, data: filters });
    } catch (error) {
        logger.error('Get All Filters (Admin) Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Create Filter
// @route   POST /api/filters
// @access  Private (Admin)
exports.createFilter = async (req, res) => {
    try {
        const { label, key, type, options, order, section } = req.body;

        const existing = await FilterConfig.findOne({ key });
        if (existing) {
            return res.status(400).json({ message: 'Filter with this key already exists' });
        }

        const filter = await FilterConfig.create({
            label, key, type, options, order, section
        });

        res.status(201).json({ success: true, data: filter });
    } catch (error) {
        logger.error('Create Filter Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Update Filter
// @route   PUT /api/filters/:id
// @access  Private (Admin)
exports.updateFilter = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const filter = await FilterConfig.findByIdAndUpdate(id, updates, { new: true, runValidators: true });

        if (!filter) {
            return res.status(404).json({ message: 'Filter not found' });
        }

        res.status(200).json({ success: true, data: filter });
    } catch (error) {
        logger.error('Update Filter Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Delete Filter
// @route   DELETE /api/filters/:id
// @access  Private (Admin)
exports.deleteFilter = async (req, res) => {
    try {
        const { id } = req.params;
        await FilterConfig.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: 'Filter deleted' });
    } catch (error) {
        logger.error('Delete Filter Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Reorder Filters (Bulk Update)
// @route   POST /api/filters/reorder
// @access  Private (Admin)
exports.reorderFilters = async (req, res) => {
    try {
        const { orders } = req.body; // Array of { id, order }

        await Promise.all(orders.map(item =>
            FilterConfig.findByIdAndUpdate(item.id, { order: item.order })
        ));

        res.status(200).json({ success: true, message: 'Filters reordered' });
    } catch (error) {
        logger.error('Reorder Filters Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
