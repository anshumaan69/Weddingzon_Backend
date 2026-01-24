const express = require('express');
const router = express.Router();
const {
    getFilters,
    getAllFilters,
    createFilter,
    updateFilter,
    deleteFilter,
    reorderFilters
} = require('../controllers/filter.controller');
const { protect, admin } = require('../middlewares/authMiddleware');

// Public
router.get('/', getFilters);

// Admin Protected
router.get('/admin', protect, admin, getAllFilters);
router.post('/', protect, admin, createFilter);
router.post('/reorder', protect, admin, reorderFilters);
router.put('/:id', protect, admin, updateFilter);
router.delete('/:id', protect, admin, deleteFilter);

module.exports = router;
