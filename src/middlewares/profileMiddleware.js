const ensureProfileComplete = (req, res, next) => {
    // Skip for Admin
    if (req.user && (req.user.admin_role === 'admin' || req.user.admin_role === 'super_admin')) {
        return next();
    }

    // Check if profile is complete
    if (req.user && req.user.is_profile_complete) {
        return next();
    }

    // Allow specific roles if they don't require profile? (Currently all users need it)
    // If not complete:
    return res.status(403).json({
        message: 'Access denied. Please complete your profile first.',
        code: 'PROFILE_INCOMPLETE'
    });
};

module.exports = { ensureProfileComplete };
