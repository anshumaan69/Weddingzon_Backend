const Cart = require('../models/Cart');
const Product = require('../models/Product');

// Get Cart for User
exports.getCart = async (req, res) => {
    try {
        let cart = await Cart.findOne({ user: req.user._id }).populate({
            path: 'items.product',
            select: 'name price images vendor',
            populate: {
                path: 'vendor',
                select: 'first_name last_name vendor_details.business_name'
            }
        });

        if (!cart) {
            cart = await Cart.create({ user: req.user._id, items: [] });
        }

        res.status(200).json({ success: true, data: cart });
    } catch (error) {
        console.error('Get Cart Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Add to Cart
exports.addToCart = async (req, res) => {
    const { productId, quantity = 1 } = req.body;

    try {
        let cart = await Cart.findOne({ user: req.user._id });

        if (!cart) {
            cart = await Cart.create({ user: req.user._id, items: [] });
        }

        // Check if product exists (optional but good practice)
        // const product = await Product.findById(productId);
        // if (!product) return res.status(404).json({ message: 'Product not found' });

        const itemIndex = cart.items.findIndex(item => item.product.toString() === productId);

        if (itemIndex > -1) {
            // Product exists in cart, update quantity
            cart.items[itemIndex].quantity += quantity;
        } else {
            // Add new item
            cart.items.push({ product: productId, quantity });
        }

        await cart.save();

        // Re-fetch to populate
        const updatedCart = await Cart.findById(cart._id).populate({
            path: 'items.product',
            select: 'name price images vendor',
            populate: {
                path: 'vendor',
                select: 'first_name last_name vendor_details.business_name'
            }
        });

        res.status(200).json({ success: true, data: updatedCart });
    } catch (error) {
        console.error('Add To Cart Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Remove from Cart
exports.removeFromCart = async (req, res) => {
    const { itemId } = req.params; // Using Product ID for simplicity in removal? Or Cart Item Subdoc ID?
    // Usually easier to remove by Product ID if we ensure unique products in cart array.
    // Let's assume itemId passed is the PRODUCT ID to remove.

    try {
        let cart = await Cart.findOne({ user: req.user._id });

        if (!cart) {
            return res.status(404).json({ message: 'Cart not found' });
        }

        cart.items = cart.items.filter(item => item.product.toString() !== itemId);

        await cart.save();

        const updatedCart = await Cart.findById(cart._id).populate({
            path: 'items.product',
            select: 'name price images vendor',
            populate: {
                path: 'vendor',
                select: 'first_name last_name vendor_details.business_name'
            }
        });

        res.status(200).json({ success: true, data: updatedCart });
    } catch (error) {
        console.error('Remove From Cart Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Update Quantity
exports.updateQuantity = async (req, res) => {
    const { itemId } = req.params; // Product ID
    const { quantity } = req.body;

    try {
        let cart = await Cart.findOne({ user: req.user._id });

        if (!cart) {
            return res.status(404).json({ message: 'Cart not found' });
        }

        const itemIndex = cart.items.findIndex(item => item.product.toString() === itemId);

        if (itemIndex > -1) {
            if (quantity > 0) {
                cart.items[itemIndex].quantity = quantity;
            } else {
                // If quantity 0 or less, remove item? Or just return error?
                // Typically remove.
                cart.items.splice(itemIndex, 1);
            }
            await cart.save();

            const updatedCart = await Cart.findById(cart._id).populate({
                path: 'items.product',
                select: 'name price images vendor',
                populate: {
                    path: 'vendor',
                    select: 'first_name last_name vendor_details.business_name'
                }
            });

            res.status(200).json({ success: true, data: updatedCart });
        } else {
            res.status(404).json({ message: 'Item not found in cart' });
        }
    } catch (error) {
        console.error('Update Quantity Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Clear Cart
exports.clearCart = async (req, res) => {
    try {
        let cart = await Cart.findOne({ user: req.user._id });
        if (cart) {
            cart.items = [];
            await cart.save();
        }
        res.status(200).json({ success: true, data: { items: [] } });
    } catch (error) {
        console.error('Clear Cart Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
