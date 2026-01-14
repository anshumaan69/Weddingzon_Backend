const csrfProtection = (req, res, next) => {
    // Skip for non-mutating requests if desired, but usually strict for API
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // SKIP CSRF check for Mobile/API clients using Bearer Tokens
    // CSRF is primarily a browser-cookie vulnerability. Explicit headers (Bearer) are safe.
    // Also skip for Dart/Flutter mobile app which might send cookies but not the CSRF header
    const userAgent = req.headers['user-agent'] || '';
    if (req.headers.authorization || userAgent.includes('Dart') || userAgent.includes('Postman')) {
        return next();
    }

    const csrfTokenHeader = req.headers['x-csrf-token'];
    const csrfTokenCookie = req.cookies['csrf_token'];

    console.log('[DEBUG CSRF] Header:', csrfTokenHeader);
    console.log('[DEBUG CSRF] Cookie:', csrfTokenCookie);

    if (!csrfTokenHeader || !csrfTokenCookie || csrfTokenHeader !== csrfTokenCookie) {
        console.error('[DEBUG CSRF] Mismatch or Missing');
        return res.status(403).json({ message: 'Invalid CSRF Token' });
    }

    next();
};

module.exports = { csrfProtection };
