/**
 * Home Controller
 * Handles basic routes like Home and Health Check
 */

exports.getHomePage = (req, res) => {
    res.status(200).send('Welcome to Weddingzon Backend API');
};

exports.getHealthCheck = (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date(),
        uptime: process.uptime()
    });
};
