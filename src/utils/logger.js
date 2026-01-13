const logger = {
    info: (message, meta = {}) => {
        console.log(`[${new Date().toISOString()}] [INFO] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    },
    error: (message, meta = {}) => {
        console.error(`[${new Date().toISOString()}] [ERROR] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    },
    warn: (message, meta = {}) => {
        console.warn(`[${new Date().toISOString()}] [WARN] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    },
    debug: (message, meta = {}) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[${new Date().toISOString()}] [DEBUG] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
        }
    }
};

module.exports = logger;
