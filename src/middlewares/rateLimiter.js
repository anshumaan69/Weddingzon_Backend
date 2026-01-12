const { RateLimiterMemory } = require('rate-limiter-flexible');

const rateLimiter = new RateLimiterMemory({
    points: 3, // 3 requests
    duration: 60 * 60, // per 1 hour per IP
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
