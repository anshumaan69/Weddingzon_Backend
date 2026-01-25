const { getPreSignedUrl, uploadToS3 } = require('../utils/s3'); // Import centralized s3 utils
const logger = require('../utils/logger');

// Cache already handled in s3.js
// ... other imports

// Local logic removed in favor of centralized s3.js logic

// ... existing code ...
// Old getMe removed
const { OAuth2Client } = require('google-auth-library');
// Twilio Removed by User Request
// Mock Mode Active

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');

const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.CALLBACK_URL
);

console.log('[DEBUG] Auth Controller Loaded');
console.log('[DEBUG] GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID); // Log actual value for debugging
console.log('[DEBUG] CALLBACK_URL:', process.env.CALLBACK_URL);

// --- Helper Functions ---

const generateTokens = (userId) => {
    // Access Token: Short Lived (15m)
    const accessToken = jwt.sign(
        { id: userId, type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
    );

    // Refresh Token: Long Lived (30d)
    const secret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET;

    const refreshToken = jwt.sign(
        { id: userId, type: 'refresh' },
        secret,
        { expiresIn: '30d' }
    );

    return { accessToken, refreshToken };
};

const getCookieOptions = () => {
    const isProd = process.env.NODE_ENV === 'production';
    return {
        httpOnly: true,
        // Secure is REQUIRED for SameSite=None
        secure: isProd || process.env.NODE_ENV === 'staging',
        // 'None' allows cross-site (required if frontend/backend check origins differently)
        // 'Lax' is safer for localhost if not using HTTPS
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
        // Domain helps if you have subdomains (client.app.com calls api.app.com)
        // domain: isProd ? '.yourdomain.com' : undefined 
    };
};

const setCookies = (req, res, accessToken, refreshToken) => {
    const options = getCookieOptions();

    // Access Token (15 mins)
    res.cookie('access_token', accessToken, {
        ...options,
        maxAge: 15 * 60 * 1000
    });

    // Refresh Token (30 days)
    res.cookie('refresh_token', refreshToken, {
        ...options,
        maxAge: 30 * 24 * 60 * 60 * 1000
    });

    // CSRF Token
    const csrfOptions = { ...options, httpOnly: false };
    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', csrfToken, csrfOptions);
};

const clearCookies = (req, res) => {
    const options = getCookieOptions();
    res.clearCookie('access_token', options);
    res.clearCookie('refresh_token', options);
    res.clearCookie('csrf_token', { ...options, httpOnly: false });
};

// --- Controllers ---

exports.googleAuth = async (req, res) => {
    console.log('[DEBUG] googleAuth Called'); // Verification log
    const { code, redirect_uri, idToken } = req.body;
    try {
        let payload;

        // Known Web Client ID from Flutter App
        const FLUTTER_CLIENT_ID = '294108253572-oih80rbj00t8rrntjincau7hi6cbji4f.apps.googleusercontent.com';
        const ANDROID_CLIENT_ID = '294108253572-90qnhlmcjf8nugpdfqn3m0f1m9nl8q2p.apps.googleusercontent.com'; // From user screenshot
        const validAudiences = [process.env.GOOGLE_CLIENT_ID, FLUTTER_CLIENT_ID, ANDROID_CLIENT_ID];

        if (idToken) {
            // Case 1: Client sent ID Token directly (Implicit Flow / Mobile default)
            console.log('[AUTH] Verifying ID Token...');
            console.log('[AUTH] Valid Audiences:', validAudiences);
            try {
                const ticket = await client.verifyIdToken({
                    idToken: idToken,
                    audience: validAudiences,
                });
                payload = ticket.getPayload();
                console.log('[AUTH] Token verified. Payload:', payload);
            } catch (verifyError) {
                console.error('[AUTH] ID Token Verification Failed:', verifyError.message);
                throw verifyError;
            }
        } else {
            // Case 2: Authorization Code Flow
            const usedRedirectUri = redirect_uri || 'postmessage';
            console.log(`[AUTH DEBUG] Exchanging Code. URI: ${usedRedirectUri}`);

            const { tokens } = await client.getToken({
                code,
                redirect_uri: usedRedirectUri
            });

            client.setCredentials(tokens);
            const ticket = await client.verifyIdToken({
                idToken: tokens.id_token,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
            payload = ticket.getPayload();
        }

        const { email, given_name, family_name, picture } = payload;

        let user = await User.findOne({ email });

        if (!user) {
            let baseUsername = email.split('@')[0];
            let username = baseUsername;

            // Generate unique username
            const randomSuffix = Math.floor(1000 + Math.random() * 9000);
            username = `${baseUsername}${randomSuffix}`;

            user = new User({
                email,
                first_name: given_name,
                last_name: family_name,
                auth_provider: 'google',
                username: username,
                profilePhoto: picture,
                is_profile_complete: false // Consistent init
            });
            await user.save();
        } else if (!user.profilePhoto) {
            // Update profilePhoto if missing
            user.profilePhoto = picture;

            // Self-heal: Fix invalid location data (missing coordinates) that causes save errors
            if (user.location && user.location.type === 'Point' && (!user.location.coordinates || user.location.coordinates.length === 0)) {
                user.location = undefined;
            }

            await user.save();
        }

        if (user.status === 'suspended' || user.status === 'banned') {
            logger.warn(`Blocked Login Attempt: ${email} (Status: ${user.status})`);
            return res.status(403).json({ message: 'Account suspended or banned' });
        }

        const { accessToken, refreshToken } = generateTokens(user._id);
        setCookies(req, res, accessToken, refreshToken);

        logger.info(`Google Auth Success: ${email}`);
        res.status(200).json({ success: true, user, accessToken, refreshToken });
    } catch (error) {
        // Fallback logging for Circular Structure errors
        try {
            logger.error('Google Auth Failed', { error: error.message, stack: error.stack });
        } catch (logError) {
            console.error('[CRITICAL] Logger Failed:', logError);
            console.error('[CRITICAL] Original Error:', error);
        }

        if (!res.headersSent) {
            res.status(401).json({
                message: 'Authentication failed: ' + (error ? error.message : 'Unknown Error'),
                debug: process.env.NODE_ENV !== 'production' ? String(error) : undefined
            });
        }
    }
};

// --- Traditional Login (Username/Password) ---
exports.login = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    try {
        const user = await User.findOne({ username }).select('+password');

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Check Ban/Suspension
        if (user.status === 'suspended' || user.status === 'banned') {
            return res.status(403).json({ message: 'Account is suspended or banned' });
        }

        // Generate Tokens
        const { accessToken, refreshToken } = generateTokens(user._id);
        setCookies(req, res, accessToken, refreshToken);

        // Remove password from response
        user.password = undefined;

        logger.info(`Login Success: ${username}`);
        res.status(200).json({ success: true, user, accessToken });
    } catch (error) {
        logger.error('Login Error', { error: error.message });
        res.status(500).json({ message: 'Login failed' });
    }
};

exports.sendOtp = async (req, res) => {
    let { phone } = req.body;

    if (!phone) return res.status(400).json({ message: 'Phone number is required' });

    // Format Phone
    phone = phone.toString().replace(/\s+/g, '');
    if (!phone.startsWith('+')) phone = '+91' + phone;

    try {
        const otp = '123456';
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 Minutes
        let user;

        // 1. Check if user is already authenticated (Linking Phone Flow / Google Signup)
        let token;
        if (req.cookies.access_token) {
            token = req.cookies.access_token;
        } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                user = await User.findById(decoded.id);

                if (user) {
                    // Check if this phone is already taken by ANOTHER user
                    const existingUser = await User.findOne({
                        $or: [{ phone }, { temp_phone: phone }]
                    });

                    if (existingUser && existingUser._id.toString() !== user._id.toString()) {
                        // Phone collision
                        if (existingUser.phone === phone) {
                            // It is a verified phone of another user -> Treat as Login attempt to that account
                            user = existingUser;
                        } else {
                            // It is a temp_phone of another user -> Conflict
                            return res.status(400).json({ message: 'Phone number is already being verified by another account' });
                        }
                    } else {
                        // No collision: Link phone to CURRENT user (Temporarily)
                        user.temp_phone = phone;
                    }
                }
            } catch (err) {
                // Token invalid/expired - treat as Guest
                console.log('OTP Token verification failed, proceeding as guest', err.message);
            }
        }

        // 2. Guest Flow (Login)
        if (!user) {
            user = await User.findOne({ phone });
            // Block Unregistered Users trying to login via OTP
            if (!user) {
                return res.status(404).json({
                    message: 'This phone number is not registered. Please sign up using Google first.',
                    code: 'USER_NOT_FOUND'
                });
            }
        }

        user.otp = otp;
        user.otpExpires = otpExpires;
        await user.save();

        // Mock Send Log
        logger.info(`MOCK OTP Sent to ${phone} (User: ${user.username}): ${otp}`);

        res.status(200).json({
            message: 'OTP sent successfully (MOCK: 123456)',
            success: true
        });

    } catch (error) {
        logger.error('Send OTP Error', { phone, error: error.message });
        res.status(500).json({ message: 'Failed to send OTP' });
    }
};

exports.verifyOtp = async (req, res) => {
    let { phone, code } = req.body;

    if (!phone || !code) return res.status(400).json({ message: 'Phone and Code required' });

    phone = phone.toString().replace(/\s+/g, '');
    if (!phone.startsWith('+')) phone = '+91' + phone;

    try {
        // Fetch User with OTP fields
        // Look in both phone (Login) and temp_phone (Signup/Linking)
        const user = await User.findOne({
            $or: [{ phone }, { temp_phone: phone }]
        }).select('+otp +otpExpires +temp_phone +phone');

        if (!user || !user.otp || !user.otpExpires) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        // Check Expiry
        if (user.otpExpires < Date.now()) {
            return res.status(400).json({ message: 'OTP expired' });
        }

        // Check Match
        if (user.otp !== code) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        // Success: Clear OTP
        user.otp = undefined;
        user.otpExpires = undefined;

        // Finalize Phone Link if it was temporary
        if (user.temp_phone === phone) {
            user.phone = phone;
            user.temp_phone = undefined;
        }

        // Mark Verified if not
        if (!user.is_phone_verified) user.is_phone_verified = true;

        await user.save();

        // Login / Token Gen
        const { accessToken, refreshToken } = generateTokens(user._id);
        setCookies(req, res, accessToken, refreshToken);

        logger.info(`OTP Verified: ${phone}`);

        // Return user (hide sensitive)
        const userObj = user.toObject();
        delete userObj.otp;
        delete userObj.otpExpires;
        delete userObj.password;

        return res.status(200).json({ success: true, user: userObj, accessToken, refreshToken });

    } catch (error) {
        logger.error(`Verify OTP Error: ${phone}`, { error: error.message });
        res.status(500).json({ message: 'Verification failed' });
    }
};

exports.registerDetails = async (req, res) => {
    const {
        first_name, last_name, dob, role, created_for,
        gender, height, marital_status, mother_tongue, disability, aadhar_number, blood_group
    } = req.body;

    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (first_name) user.first_name = first_name;
        if (last_name) user.last_name = last_name;
        if (role) user.role = role;
        if (created_for) user.created_for = created_for;

        // Franchise Details - Only if role is franchise
        if (role === 'franchise' && req.body.franchise_details) {
            user.franchise_details = {
                ...user.franchise_details, // Keep existing if any (though usually empty at start)
                ...req.body.franchise_details
            };
        }
        if (dob) {
            user.dob = dob;
            // Age Validation
            const toDate = new Date();
            const birthDate = new Date(dob);
            let age = toDate.getFullYear() - birthDate.getFullYear();
            const m = toDate.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && toDate.getDate() < birthDate.getDate())) {
                age--;
            }
            if (age < 18) {
                return res.status(400).json({ message: 'You must be at least 18 years old.' });
            }
            if (age > 150) {
                return res.status(400).json({ message: 'Invalid age. Maximum age allowed is 150 years.' });
            }
        } else {
            // Persist existing dob
            user.dob = user.dob;
        }

        // Basic Details
        if (gender) user.gender = gender;
        if (height) user.height = height;
        if (marital_status) user.marital_status = marital_status;
        if (mother_tongue) user.mother_tongue = mother_tongue;
        if (disability) user.disability = disability;
        if (aadhar_number) user.aadhar_number = aadhar_number;
        if (blood_group) user.blood_group = blood_group;

        // Location Details
        if (req.body.country) user.country = req.body.country;
        if (req.body.state) user.state = req.body.state;
        if (req.body.city) user.city = req.body.city;

        // Family Details
        if (req.body.father_status) user.father_status = req.body.father_status;
        if (req.body.mother_status) user.mother_status = req.body.mother_status;
        if (req.body.brothers !== undefined) user.brothers = req.body.brothers;
        if (req.body.sisters !== undefined) user.sisters = req.body.sisters;
        if (req.body.family_status) user.family_status = req.body.family_status;
        if (req.body.family_type) user.family_type = req.body.family_type;
        if (req.body.family_values) user.family_values = req.body.family_values;
        if (req.body.annual_income) user.annual_income = req.body.annual_income;
        if (req.body.family_location) user.family_location = req.body.family_location;

        // Education & Career
        if (req.body.highest_education) user.highest_education = req.body.highest_education;
        if (req.body.educational_details) user.educational_details = req.body.educational_details;
        if (req.body.occupation) user.occupation = req.body.occupation;
        if (req.body.employed_in) user.employed_in = req.body.employed_in;
        if (req.body.personal_income) user.personal_income = req.body.personal_income;
        if (req.body.working_sector) user.working_sector = req.body.working_sector;
        if (req.body.working_location) user.working_location = req.body.working_location;

        // Religious Background
        if (req.body.religion) user.religion = req.body.religion;
        if (req.body.community) user.community = req.body.community;
        if (req.body.sub_community) user.sub_community = req.body.sub_community;

        // Lifestyle & Property
        if (req.body.appearance) user.appearance = req.body.appearance;
        if (req.body.living_status) user.living_status = req.body.living_status;
        if (req.body.physical_status) user.physical_status = req.body.physical_status;
        if (req.body.eating_habits) user.eating_habits = req.body.eating_habits;
        if (req.body.smoking_habits) user.smoking_habits = req.body.smoking_habits;
        if (req.body.drinking_habits) user.drinking_habits = req.body.drinking_habits;
        if (req.body.hobbies) user.hobbies = req.body.hobbies;
        if (req.body.property_types) user.property_types = req.body.property_types;
        if (req.body.land_types) user.land_types = req.body.land_types;
        if (req.body.land_area) user.land_area = req.body.land_area;
        if (req.body.house_types) user.house_types = req.body.house_types;
        if (req.body.business_types) user.business_types = req.body.business_types;

        // Contact & About
        if (req.body.alternate_mobile) user.alternate_mobile = req.body.alternate_mobile;
        if (req.body.suitable_time_to_call) user.suitable_time_to_call = req.body.suitable_time_to_call;

        // Allow updating phone if not set (e.g. Google Auth)
        // Allow updating phone if not set (e.g. Google Auth)
        if (req.body.phone && !user.phone) {
            // Check if phone is already used
            const existingUser = await User.findOne({ phone: req.body.phone });
            if (existingUser) {
                console.error('[DEBUG] Phone collision (initial set):', req.body.phone);
                return res.status(400).json({ message: 'Phone number already in use' });
            }
            user.phone = req.body.phone;
        } else if (req.body.phone && user.phone !== req.body.phone) {
            // Optional: Allow changing phone? For now let's only allow if it was empty, 
            // OR if we assume they verified it (which we don't here).
            // Let's stick to: Update logic if they want to change it, but check uniqueness.
            const existingUser = await User.findOne({ phone: req.body.phone });
            if (existingUser && existingUser._id.toString() !== user._id.toString()) {
                console.error('[DEBUG] Phone collision (update):', req.body.phone);
                return res.status(400).json({ message: 'Phone number already in use' });
            }
            user.phone = req.body.phone;
        }

        if (req.body.about_me) user.about_me = req.body.about_me;

        // Username Update Logic REMOVED
        // Usernames are now immutable and auto-generated
        if (req.body.username && req.body.username !== user.username) {
            return res.status(400).json({ message: 'Username cannot be changed.' });
        }

        // Only mark complete if explicitly requested AND essentials are present
        if (req.body.is_profile_complete) {
            if (user.first_name && user.dob && user.gender && user.religion && user.about_me) {
                user.is_profile_complete = true;
            }
        }

        await user.save();

        // Invalidate Cache


        logger.info(`Profile Updated: ${user.username}`);
        res.status(200).json({ message: 'Profile updated successfully', user });
    } catch (error) {
        logger.error('Register Details Error', { error: error.message });
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Username/Email/Phone already taken (Duplicate Key).' });
        }
        res.status(500).json({ message: 'Failed to update profile' });
    }
};

exports.refreshToken = async (req, res) => {
    try {
        const incomingRefreshToken = req.cookies?.refresh_token || req.body?.refreshToken;
        if (!incomingRefreshToken) {
            // Only log if explicit body token is missing too, common for first load
            return res.status(401).json({ message: 'No refresh token' });
        }

        const secret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET;
        if (!secret) {
            logger.error('CRITICAL: JWT Secret missing in Refresh Token logic');
            return res.status(500).json({ message: 'Server configuration error' });
        }

        const decoded = jwt.verify(incomingRefreshToken, secret);

        if (decoded.type !== 'refresh') throw new Error('Invalid type');

        const newAccessToken = jwt.sign(
            { id: decoded.id, type: 'access' },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );

        const options = getCookieOptions();
        res.cookie('access_token', newAccessToken, {
            ...options,
            maxAge: 15 * 60 * 1000
        });

        // Refresh CSRF
        const csrfOptions = { ...options, httpOnly: false };
        const csrfToken = crypto.randomBytes(32).toString('hex');
        res.cookie('csrf_token', csrfToken, csrfOptions);

        res.status(200).json({ success: true, accessToken: newAccessToken });
    } catch (error) {
        logger.error('Refresh Token Failed', { error: error.message, stack: error.stack });
        clearCookies(req, res);
        res.status(401).json({ message: 'Session expired' });
    }
};

exports.logout = async (req, res) => {
    clearCookies(req, res);

    // Safety Net: Explicitly expire them manually just in case
    const options = getCookieOptions();
    res.cookie('access_token', '', { ...options, maxAge: 0 });
    res.cookie('refresh_token', '', { ...options, maxAge: 0 });
    res.cookie('csrf_token', '', { ...options, httpOnly: false, maxAge: 0 });

    logger.info('User Logged Out (Cookies Cleared)');
    res.status(200).json({ message: 'Logged out successfully' });
};

exports.getMe = async (req, res) => {
    const startTotal = performance.now();
    try {
        // Cache removed to ensure role updates are reflected immediately
        // res.set('Cache-Control', 'private, max-age=60');

        // Optimization: user is already fetched in authMiddleware with lean()
        const user = req.user; // Already retrieved from Cache or DB in middleware

        if (!user) return res.status(404).json({ message: 'User not found' });

        // Clone user object since req.user might be frozen/const from middleware
        let userObj = { ...user };

        const startSign = performance.now(); // Fix missing declaration if performance is global in Node 22, otherwise might need import. 
        // Node 16+ has performance globally available via perf_hooks unless overridden. 
        // Assuming global usage given previous context.

        if (userObj.photos && userObj.photos.length > 0) {
            // ALWAYS sign all photos for getMe to ensure mobile clients (Flutter) work out of the box
            // The previous optimization required ?full=true which the client might not be sending.
            // Performance impact: minimal for ~5-10 photos.

            userObj.photos = await Promise.all(userObj.photos.map(async (photo) => {
                let signedUrl = null;
                if (photo.key) {
                    signedUrl = await getPreSignedUrl(photo.key);
                }
                return { ...photo, url: signedUrl || photo.url };
            }));

            // Sync profilePhoto link
            const profilePhotoObj = userObj.photos.find(p => p.isProfile) || userObj.photos[0];
            if (profilePhotoObj && profilePhotoObj.url) {
                userObj.profilePhoto = profilePhotoObj.url;
            }
        }
        const endSign = performance.now();
        const signTime = (endSign - startSign).toFixed(2);
        const totalTime = (performance.now() - startTotal).toFixed(2);

        // Add Server-Timing Header (visible in DevTools)
        res.set('Server-Timing', `sign;dur=${signTime}, total;dur=${totalTime}`);

        res.status(200).json(userObj);
    } catch (error) {
        logger.error('GetMe Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

exports.checkUsername = async (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ message: 'Username is required' });

    try {
        const user = await User.findOne({ username });
        if (user) {
            return res.status(200).json({ available: false, message: 'Username is taken' });
        }
        return res.status(200).json({ available: true, message: 'Username is available' });
    } catch (error) {
        logger.error('Check Username Error', { error: error.message });
        res.status(500).json({ message: 'Server check failed' });
    }
};
