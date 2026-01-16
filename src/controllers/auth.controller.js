const { getPreSignedUrl, uploadToS3 } = require('../utils/s3'); // Import centralized s3 utils
const logger = require('../utils/logger');
const { userCache } = require('../utils/cache');
// Cache already handled in s3.js
// ... other imports

// Local logic removed in favor of centralized s3.js logic

// ... existing code ...

// Old getMe removed
const { OAuth2Client } = require('google-auth-library');
const twilio = require('twilio');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');

const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.CALLBACK_URL
);

console.log('[DEBUG] Auth Controller Loaded');
console.log('[DEBUG] GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'LOADED' : 'MISSING');
console.log('[DEBUG] CALLBACK_URL:', process.env.CALLBACK_URL);

let twilioClient;
try {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
        twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    }
} catch (e) {
    console.warn('Failed to initialize Twilio client:', e.message);
}

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
            const { tokens } = await client.getToken({
                code,
                redirect_uri: redirect_uri || 'postmessage'
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
                avatar: picture,
                is_profile_complete: false // Consistent init
            });
            await user.save();
        } else if (!user.avatar) {
            // Update avatar if missing
            user.avatar = picture;
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
        logger.error('Google Auth Failed', { error: error.message, stack: error.stack });
        res.status(401).json({ message: 'Authentication failed: ' + error.message });
    }
};

exports.sendOtp = async (req, res) => {
    let { phone } = req.body;

    if (phone) {
        phone = phone.toString().replace(/\s+/g, '');
        if (!phone.startsWith('+')) phone = '+91' + phone;
    }

    try {
        // Mock OTP Logic - No Twilio
        // Always return 123456 for dev
        logger.info(`OTP Mock Sent: ${phone}`);
        return res.status(200).json({
            message: 'OTP sent successfully (MOCK)',
            otp: '123456',
            success: true
        });

    } catch (error) {
        logger.error('Send OTP Failed', { phone, error: error.message });
        res.status(500).json({ message: 'Failed to send OTP' });
    }
};

exports.verifyOtp = async (req, res) => {
    let { phone, code } = req.body;
    let isVerified = false;

    if (phone) {
        phone = phone.toString().replace(/\s+/g, '');
        if (!phone.startsWith('+')) phone = '+91' + phone;
    }

    try {
        // Mock Verification
        if (code === '123456') {
            isVerified = true;
        }

        if (isVerified) {
            let user = await User.findOne({ phone });

            if (user) {
                // Login Flow
                const { accessToken, refreshToken } = generateTokens(user._id);
                setCookies(req, res, accessToken, refreshToken);
                logger.info(`OTP Login Success: ${phone}`);
                return res.status(200).json({ success: true, user, accessToken, refreshToken });
            }

            // Signup Link Flow
            const incomingToken = req.cookies.access_token;
            if (incomingToken) {
                try {
                    const decoded = jwt.verify(incomingToken, process.env.JWT_SECRET);
                    user = await User.findById(decoded.id);
                    if (user) {
                        user.phone = phone;
                        user.is_phone_verified = true;
                        await user.save();

                        const { accessToken, refreshToken } = generateTokens(user._id);
                        setCookies(req, res, accessToken, refreshToken);
                        logger.info(`OTP Linked Success: ${phone} to User ${user._id}`);
                        return res.status(200).json({ success: true, user, accessToken, refreshToken });
                    }
                } catch (e) { /* ignore */ }
            }

            logger.warn(`OTP Verified but Account Not Found/Linked: ${phone}`);
            return res.status(400).json({
                message: 'Account not found. Please signup with Google first.',
                error: 'signup_required'
            });

        } else {
            logger.warn(`Invalid OTP Attempt: ${phone}`);
            return res.status(400).json({ message: 'Invalid OTP' });
        }
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
        user.dob = dob || user.dob;

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

        // Username Update Logic
        if (req.body.username && req.body.username !== user.username) {
            const existingUsername = await User.findOne({ username: req.body.username });
            if (existingUsername) {
                return res.status(400).json({ message: 'Username is already taken' });
            }
            user.username = req.body.username;
        }

        // Only mark complete if we have the essentials
        console.log('User Profile Updated. About Me Length:', user.about_me ? user.about_me.length : 0);
        if (user.first_name && user.dob && user.gender && user.religion && user.about_me) {
            user.is_profile_complete = true;
        }

        await user.save();

        // Invalidate Cache
        userCache.delete(`user:${user._id}`);

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
    const incomingRefreshToken = req.cookies.refresh_token || req.body.refreshToken;
    if (!incomingRefreshToken) return res.status(401).json({ message: 'No refresh token' });

    try {
        const secret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET;
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
        clearCookies(req, res);
        res.status(401).json({ message: 'Session expired' });
    }
};

exports.logout = async (req, res) => {
    clearCookies(req, res);
    logger.info('User Logged Out');
    res.status(200).json({ message: 'Logged out' });
};

exports.getMe = async (req, res) => {
    const startTotal = performance.now();
    try {
        // Cache for 60 seconds (Client Side) - Reduces repeat fetches on navigation
        res.set('Cache-Control', 'private, max-age=60');

        // Optimization: user is already fetched in authMiddleware with lean()
        const user = req.user; // Already retrieved from Cache or DB in middleware

        if (!user) return res.status(404).json({ message: 'User not found' });

        // --- Selective Photo Signing Optimization ---
        const userObj = user;
        const wantFullPhotos = req.query.full === 'true';

        const startSign = performance.now();

        if (userObj.photos && userObj.photos.length > 0) {
            if (wantFullPhotos) {
                // Heavy: Sign ALL photos (Only for Onboarding/Edit Profile)
                userObj.photos = await Promise.all(userObj.photos.map(async (photo) => {
                    let signedUrl = null;
                    if (photo.key) {
                        signedUrl = await getPreSignedUrl(photo.key);
                    }
                    return { ...photo, url: signedUrl || photo.url };
                }));

                // Update profilePhoto link if needed
                const profilePhotoObj = userObj.photos.find(p => p.isProfile) || userObj.photos[0];
                if (profilePhotoObj && profilePhotoObj.url) {
                    userObj.profilePhoto = profilePhotoObj.url;
                }
            } else {
                // Light: Sign ONLY Profile Photo (Default for Feed/Header)
                // We don't sign the whole 'photos' array, leaving the keys/URLs as is (expired or raw)
                // We only ensure userObj.profilePhoto is fresh.

                const profilePhotoObj = userObj.photos.find(p => p.isProfile) || userObj.photos[0];
                if (profilePhotoObj && profilePhotoObj.key) {
                    const signedUrl = await getPreSignedUrl(profilePhotoObj.key);
                    userObj.profilePhoto = signedUrl;

                    // Also update it inside the array just in case frontend reads from there
                    // But we won't iterate the whole array
                    profilePhotoObj.url = signedUrl;
                }
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
