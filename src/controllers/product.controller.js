const Product = require('../models/Product');
const User = require('../models/User');
const logger = require('../utils/logger');
const { getSignedFileUrl } = require('../utils/s3');

// @desc    Create a new product
// @route   POST /api/products
// @access  Private (Vendor only)
exports.createProduct = async (req, res) => {
    try {
        const { name, description, price, category, images } = req.body;

        const product = await Product.create({
            vendor: req.user._id,
            name,
            description,
            price,
            category,
            images
        });

        res.status(201).json({
            success: true,
            data: product
        });
    } catch (error) {
        logger.error('Create Product Error', { error: error.message });
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Get all products (with filtering)
// @route   GET /api/products
// @access  Public
exports.getProducts = async (req, res) => {
    try {
        const { category, minPrice, maxPrice, search, page = 1, limit = 12 } = req.query;
        const query = { isActive: true };

        if (category) {
            query.category = category;
        }

        if (minPrice || maxPrice) {
            query.price = {};
            if (minPrice) query.price.$gte = Number(minPrice);
            if (maxPrice) query.price.$lte = Number(maxPrice);
        }

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const count = await Product.countDocuments(query);
        const products = await Product.find(query)
            .populate('vendor', 'first_name last_name vendor_details')
            .sort({ created_at: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        // Sign images
        const productsWithSignedImages = await Promise.all(products.map(async (product) => {
            const productObj = product.toObject();
            if (productObj.images && productObj.images.length > 0) {
                productObj.images = await Promise.all(productObj.images.map(img => getSignedFileUrl(img)));
            }
            return productObj;
        }));

        res.status(200).json({
            success: true,
            data: productsWithSignedImages,
            pagination: {
                total: count,
                page: Number(page),
                limit: Number(limit),
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        logger.error('Get Products Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get single product details
// @route   GET /api/products/:id
// @access  Public
exports.getProductById = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id)
            .populate('vendor', 'first_name last_name vendor_details profilePhoto email phone')
            .populate('reviews.user', 'first_name last_name profilePhoto');

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const productObj = product.toObject();
        if (productObj.images && productObj.images.length > 0) {
            productObj.images = await Promise.all(productObj.images.map(img => getSignedFileUrl(img)));
        }

        res.status(200).json({ success: true, data: productObj });
    } catch (error) {
        logger.error('Get Product By ID Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get logged in vendor's products
// @route   GET /api/products/my
// @access  Private (Vendor)
exports.getMyProducts = async (req, res) => {
    try {
        const products = await Product.find({ vendor: req.user._id }).sort({ created_at: -1 });

        const productsWithSignedImages = await Promise.all(products.map(async (product) => {
            const productObj = product.toObject();
            if (productObj.images && productObj.images.length > 0) {
                productObj.images = await Promise.all(productObj.images.map(img => getSignedFileUrl(img)));
            }
            return productObj;
        }));

        res.status(200).json({ success: true, data: productsWithSignedImages });
    } catch (error) {
        logger.error('Get My Products Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Update product
// @route   PATCH /api/products/:id
// @access  Private (Vendor/Admin)
exports.updateProduct = async (req, res) => {
    try {
        let product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Check ownership (unless admin)
        if (product.vendor.toString() !== req.user._id.toString() && req.user.role !== 'admin' && req.user.admin_role !== 'super_admin') {
            return res.status(401).json({ message: 'Not authorized to update this product' });
        }

        product = await Product.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        res.status(200).json({ success: true, data: product });
    } catch (error) {
        logger.error('Update Product Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private (Vendor/Admin)
exports.deleteProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Check ownership
        if (product.vendor.toString() !== req.user._id.toString() && req.user.role !== 'admin' && req.user.admin_role !== 'super_admin') {
            return res.status(401).json({ message: 'Not authorized to delete this product' });
        }

        await product.deleteOne();

        res.status(200).json({ success: true, message: 'Product removed' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Create new review
// @route   POST /api/products/:id/reviews
// @access  Private
exports.addProductReview = async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const alreadyReviewed = product.reviews.find(
            (r) => r.user.toString() === req.user._id.toString()
        );

        if (alreadyReviewed) {
            return res.status(400).json({ message: 'Product already reviewed' });
        }

        const review = {
            name: req.user.first_name + ' ' + req.user.last_name,
            rating: Number(rating),
            comment,
            user: req.user._id,
        };

        product.reviews.push(review);

        product.numReviews = product.reviews.length;

        product.averageRating =
            product.reviews.reduce((acc, item) => item.rating + acc, 0) /
            product.reviews.length;

        await product.save();

        res.status(201).json({ message: 'Review added' });
    } catch (error) {
        logger.error('Add Product Review Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
