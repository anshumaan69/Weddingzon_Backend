const express = require('express');
const router = express.Router();
const {
    getCart,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart
} = require('../controllers/cart.controller');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getCart);
router.post('/add', addToCart);
router.post('/remove/:itemId', removeFromCart); // itemId here refers to Product ID
router.patch('/update/:itemId', updateQuantity);
router.delete('/', clearCart);

module.exports = router;
