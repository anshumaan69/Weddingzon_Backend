const { RateLimiterMemory } = require('rate-limiter-flexible');

const rateLimiter = new RateLimiterMemory({
    points: 50, // 50 requests (effectively disabled for manual testing)
    duration: 60, // per 60 seconds per IP
});

const rateLimiterMiddleware = (req, res, next) => {
    rateLimiter.consume(req.ip)
        .then(() => {
            next();
        })
        .catch(() => {
            res.status(429).json({ message: 'Too many requests, please try again later.' });
        });
};

module.exports = rateLimiterMiddleware;
