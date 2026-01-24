const jwt = require('jsonwebtoken');
const User = require('../models/User');


const protect = async (req, res, next) => {
    let token;

    if (req.cookies.access_token) {
        token = req.cookies.access_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 2. Fetch from DB
        req.user = await User.findById(decoded.id).select('-password').lean();

        if (!req.user) {
            return res.status(401).json({ message: 'Not authorized, user not found' });
        }

        next();
    } catch (error) {
        console.error('Auth Middleware Error:', error);
        res.status(401).json({ message: 'Not authorized, token failed' });
    }
};

const admin = (req, res, next) => {
    if (req.user && (req.user.admin_role === 'super_admin' || req.user.admin_role === 'admin')) {
        next();
    } else {
        res.status(401).json({ message: 'Not authorized as an admin' });
    }
};

const optionalAuth = async (req, res, next) => {
    let token;

    if (req.cookies.access_token) {
        token = req.cookies.access_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id).select('-password').lean();
        next();
    } catch (error) {
        // Invalid token, just proceed as guest
        next();
    }
};

module.exports = { protect, admin, optionalAuth };
