const express = require('express');
const router = express.Router();
const {
    createProduct,
    getProducts,
    getProductById,
    getMyProducts,
    updateProduct,
    deleteProduct,
    addProductReview
} = require('../controllers/product.controller');
const { protect } = require('../middlewares/authMiddleware');

// Public routes
router.get('/', getProducts);
router.get('/my/products', protect, getMyProducts);
router.get('/:id', getProductById);

// Protected routes
router.use(protect);
router.post('/', createProduct);
router.patch('/:id', updateProduct);
router.delete('/:id', deleteProduct);

router.post('/:id/reviews', addProductReview);

module.exports = router;
