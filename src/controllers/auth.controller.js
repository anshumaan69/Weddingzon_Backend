const User = require('../models/User');
const { OAuth2Client } = require('google-auth-library');
const twilio = require('twilio');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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
    const { code, redirect_uri } = req.body;
    try {
        const { tokens } = await client.getToken({
            code,
            redirect_uri: redirect_uri || process.env.CALLBACK_URL
        });

        client.setCredentials(tokens);
        const ticket = await client.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { email, given_name, family_name, picture } = payload;

        let user = await User.findOne({ email });

        if (!user) {
            user = new User({
                email,
                first_name: given_name,
                last_name: family_name,
                auth_provider: 'google',
            });
            await user.save();
        }

        if (user.status === 'suspended' || user.status === 'banned') {
            return res.status(403).json({ message: 'Account suspended or banned' });
        }

        const { accessToken, refreshToken } = generateTokens(user._id);
        setCookies(req, res, accessToken, refreshToken);

        res.status(200).json({ success: true, user });
    } catch (error) {
        console.error('Google Auth Error Details:', JSON.stringify(error, null, 2));
        console.error('Received Code:', code ? 'Yes' : 'No');
        console.error('Used Redirect URI:', redirect_uri || process.env.CALLBACK_URL);
        console.error('Env Redirect URI:', process.env.CALLBACK_URL);

        let message = 'Authentication failed';
        if (error.response && error.response.data) {
            message += `: ${JSON.stringify(error.response.data)}`;
        } else if (error.message) {
            message += `: ${error.message}`;
        }
        res.status(401).json({ message });
    }
};

exports.sendOtp = async (req, res) => {
    let { phone } = req.body;

    if (phone) {
        phone = phone.toString().replace(/\s+/g, '');
        if (!phone.startsWith('+')) phone = '+91' + phone;
    }

    try {
        if (process.env.NODE_ENV !== 'production' && phone === '+919999999999') {
            return res.status(200).json({ message: 'OTP sent successfully (MOCK TEST)' });
        }

        if (!twilioClient) {
            return res.status(200).json({ message: 'OTP sent successfully (MOCK)' });
        }

        const serviceSid = process.env.TWILIO_SERVICE_SID.trim();
        await twilioClient.verify.v2.services(serviceSid)
            .verifications.create({ to: phone.trim(), channel: 'sms' });

        res.status(200).json({ message: 'OTP sent successfully' });
    } catch (error) {
        console.error('Send OTP Error:', error);
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
        if ((process.env.NODE_ENV !== 'production' && phone === '+919999999999' && code === '123456') ||
            (!twilioClient && code === '123456')) {
            isVerified = true;
        } else {
            const serviceSid = process.env.TWILIO_SERVICE_SID.trim();
            const check = await twilioClient.verify.v2.services(serviceSid)
                .verificationChecks.create({ to: phone.trim(), code });
            if (check.status === 'approved') isVerified = true;
        }

        if (isVerified) {
            let user = await User.findOne({ phone });

            if (user) {
                // Login Flow
                const { accessToken, refreshToken } = generateTokens(user._id);
                setCookies(req, res, accessToken, refreshToken);
                return res.status(200).json({ success: true, user });
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
                        return res.status(200).json({ success: true, user });
                    }
                } catch (e) { /* ignore */ }
            }

            return res.status(400).json({
                message: 'Account not found. Please signup with Google first.',
                error: 'signup_required'
            });

        } else {
            return res.status(400).json({ message: 'Invalid OTP' });
        }
    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({ message: 'Verification failed' });
    }
};

exports.registerDetails = async (req, res) => {
    const {
        first_name, last_name, dob, role, created_for,
        gender, height, marital_status, mother_tongue, disability, aadhar_number, blood_group
    } = req.body;

    try {
        const user = await User.findById(req.user.id);
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
        if (req.body.phone && !user.phone) {
            // Check if phone is already used
            const existingUser = await User.findOne({ phone: req.body.phone });
            if (existingUser) {
                return res.status(400).json({ message: 'Phone number already in use' });
            }
            user.phone = req.body.phone;
        } else if (req.body.phone && user.phone !== req.body.phone) {
            // Optional: Allow changing phone? For now let's only allow if it was empty, 
            // OR if we assume they verified it (which we don't here).
            // Let's stick to: Update logic if they want to change it, but check uniqueness.
            const existingUser = await User.findOne({ phone: req.body.phone });
            if (existingUser && existingUser._id.toString() !== user._id.toString()) {
                return res.status(400).json({ message: 'Phone number already in use' });
            }
            user.phone = req.body.phone;
        }

        if (req.body.about_me) user.about_me = req.body.about_me;

        // Only mark complete if we have the essentials
        console.log('User Profile Updated. About Me Length:', user.about_me ? user.about_me.length : 0);
        if (user.first_name && user.dob && user.gender && user.religion && user.about_me) {
            user.is_profile_complete = true;
        }

        await user.save();
        res.status(200).json({ message: 'Profile updated successfully', user });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Username already taken.' });
        }
        res.status(500).json({ message: 'Failed to update profile' });
    }
};

exports.refreshToken = async (req, res) => {
    const incomingRefreshToken = req.cookies.refresh_token;
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

        res.status(200).json({ success: true });
    } catch (error) {
        clearCookies(req, res);
        res.status(401).json({ message: 'Session expired' });
    }
};

exports.logout = async (req, res) => {
    clearCookies(req, res);
    res.status(200).json({ message: 'Logged out' });
};

exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};
