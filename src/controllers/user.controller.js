const User = require('../models/User');
const ProfileView = require('../models/ProfileView');
const mongoose = require('mongoose');
const PhotoAccessRequest = require('../models/PhotoAccessRequest');
const ConnectionRequest = require('../models/ConnectionRequest');
const DetailsAccessRequest = require('../models/DetailsAccessRequest');
// const cloudinary = require('../config/cloudinary'); // Deprecated
// Centralized S3 Utils
const { getPreSignedUrl, uploadToS3, getSignedFileUrl } = require('../utils/s3');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Helper to resolve user by ID or Username
const resolveUser = async (identifier) => {
    // If it looks like an ObjectId, try ID first (legacy support), otherwise Username
    if (identifier && identifier.match(/^[0-9a-fA-F]{24}$/)) {
        const user = await User.findById(identifier);
        if (user) return user;
    }
    const user = await User.findOne({ username: identifier });
    if (!user) throw new Error('User not found');
    return user;
};
const { s3Client, vendorS3Client } = require('../config/s3');
const { notifyUser } = require('../services/notification.service');
const Report = require('../models/Report');

const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');


// Local getPreSignedUrl removed in favor of utils/s3.js

// @desc    Get Feed Users (Randomized Cursor Strategy)
// @route   GET /api/users/feed
// @access  Private
exports.getFeed = async (req, res) => {
    const startTotal = performance.now();
    try {
        const { cursor, viewAs, sort } = req.query;
        console.log('--- FEED DEBUG ---');
        console.log('Query:', req.query);
        console.log('User Role:', req.user.role);
        console.log('User ID:', req.user._id);

        const FETCH_SIZE = 15;
        const SHOW_SIZE = sort === 'newest' ? 15 : 9;

        // Context User (Defaults to logged-in user)
        let currentUser = req.user;

        // --- FRANCHISE RESTRICTION & LOGIC ---
        if (req.user.role === 'franchise') {
            if (!viewAs) {
                return res.status(403).json({
                    message: 'Franchise owners cannot view the feed directly. Please select a member to "View As".'
                });
            }

            console.log(`Attempting to view as: ${viewAs}`);
            const member = await User.findOne({ _id: viewAs, created_by: req.user._id }); // Removed .lean() to debug Map issue
            if (member) {
                console.log(`[Feed] Franchise ${req.user.username} viewing as ${member.username}`);
                currentUser = member.toObject({ flattenMaps: true }); // Convert Mongoose Map to POJO
                // Ensure partner_preferences is Object if lean() was used (it is)
            } else {
                console.log('[Feed] View As Member NOT FOUND or Not Authorization');
                return res.status(403).json({ message: 'Member not found or unauthorized' });
            }
        } else {
            // Normal user logic
            if (viewAs) console.log('[Feed] Ignoring viewAs param for non-franchise user');
        }

        // Base Query
        const query = {
            status: 'active',
            role: { $ne: 'franchise' }, // Exclude franchise accounts
            _id: {
                $ne: currentUser._id,
                $nin: currentUser.blockedUsers || []
            },
            is_profile_complete: true, // Show only completed profiles
            $or: [
                { 'photos.0': { $exists: true } },
                { profilePhoto: { $ne: null } }
            ]
        };

        // Cursor Pagination
        if (cursor) {
            query._id = { ...query._id, $lt: cursor };
        }

        // --- PARTNER PREFERENCES FILTER (Franchise Feature) ---
        // Debug Log
        // console.log('DEBUG FEED PREFS:', req.user.partner_preferences);

        // Handle POJO (plain object) from .lean() middleware
        // Handle POJO (plain object) from .lean() middleware
        // Use currentUser (which might be the IMPERSONATED member)
        const prefs = currentUser.partner_preferences;
        if (prefs && Object.keys(prefs).length > 0) {
            console.log(`[Feed Filter] Applying preferences for user ${currentUser.username}:`, prefs);

            // 1. Age Filter
            const minAge = prefs.minAge || prefs['minAge'];
            const maxAge = prefs.maxAge || prefs['maxAge'];
            if (minAge || maxAge) {
                const today = new Date();
                const dobQuery = {};
                if (maxAge) {
                    const date = new Date(today.getFullYear() - parseInt(maxAge) - 1, today.getMonth(), today.getDate());
                    dobQuery.$gte = date;
                }
                if (minAge) {
                    const date = new Date(today.getFullYear() - parseInt(minAge), today.getMonth(), today.getDate());
                    dobQuery.$lte = date;
                }
                if (Object.keys(dobQuery).length > 0) query.dob = dobQuery;
            }

            // 2. Religion
            const religion = prefs.religion || prefs['religion'];
            if (religion && religion !== 'Any') {
                query.religion = religion;
            }

            // 3. Community
            const community = prefs.community || prefs['community'];
            if (community) {
                query.community = { $regex: community, $options: 'i' };
            }

            // 4. Location
            const location = prefs.location || prefs['location'];
            if (location) {
                const locRegex = { $regex: location, $options: 'i' };
                const locationOr = [
                    { city: locRegex },
                    { state: locRegex },
                    { country: locRegex }
                ];

                // Wrap existing $or (photos) and new location $or into an $and
                if (query.$or) {
                    query.$and = [
                        { $or: query.$or }, // Existing Photo check
                        { $or: locationOr } // New Location check
                    ];
                    delete query.$or; // Remove top-level $or
                } else {
                    query.$or = locationOr;
                }
            }

            // 5. Marital Status
            const maritalStatus = prefs.marital_status || prefs['marital_status'];
            if (maritalStatus && maritalStatus !== 'Any') {
                query.marital_status = maritalStatus;
            }

            // 6. Diet (Eating Habits)
            const diet = prefs.eating_habits || prefs['eating_habits'];
            if (diet && diet !== 'Any') {
                query.eating_habits = diet;
            }

            // 7. Smoking Habits
            const smoking = prefs.smoking_habits || prefs['smoking_habits'];
            if (smoking && smoking !== 'Any') {
                query.smoking_habits = smoking;
            }

            // 8. Drinking Habits
            const drinking = prefs.drinking_habits || prefs['drinking_habits'];
            if (drinking && drinking !== 'Any') {
                query.drinking_habits = drinking;
            }

            // 9. Education
            const education = prefs.highest_education || prefs['highest_education'];
            if (education) {
                query.highest_education = { $regex: education, $options: 'i' };
            }

            // 10. Occupation
            const occupation = prefs.occupation || prefs['occupation'];
            if (occupation) {
                query.occupation = { $regex: occupation, $options: 'i' };
            }

            // 11. Annual Income
            const income = prefs.annual_income || prefs['annual_income'];
            if (income && income !== 'Any') {
                query.annual_income = { $regex: income, $options: 'i' };
            }
            console.log('[Feed Filter] Final Query Construction:', JSON.stringify(query, null, 2));
        } else {
            console.log(`[Feed Filter] No preferences found for user ${currentUser.username} (or empty object)`);
            console.log('Prefs Object:', prefs);
        }

        // 1. Fetch Candidates (Optimized with lean())
        let users = await User.find(query)
            .select('username first_name last_name profilePhoto photos bio created_at role dob height city caste religion highest_education occupation annual_income marital_status')
            .sort({ created_at: -1, _id: -1 })
            .limit(FETCH_SIZE)
            .lean();

        // Capture next cursor
        const nextCursor = users.length > 0 ? users[users.length - 1]._id : null;

        // 2. Shuffle Logic
        if (sort !== 'newest') {
            users = users.sort(() => Math.random() - 0.5);
        }

        // 3. Slice Logic
        const visibleUsers = sort === 'newest' ? users : users.slice(0, SHOW_SIZE);

        // 4. Process Permissions & Statuses
        let grantedUserIds = new Set();
        const isAdmin = ['admin', 'superadmin'].includes(currentUser.role); // Use currentUser context

        // Bulk Fetch Statuses
        const visibleUserIds = visibleUsers.map(u => u._id);
        const myId = currentUser._id.toString(); // Use context ID

        const [photoRequests, connectionRequests] = await Promise.all([
            PhotoAccessRequest.find({
                requester: currentUser._id, // Context
                targetUser: { $in: visibleUserIds }
            }).select('targetUser status').lean(),
            ConnectionRequest.find({
                $or: [
                    { requester: currentUser._id, recipient: { $in: visibleUserIds } }, // Context
                    { recipient: currentUser._id, requester: { $in: visibleUserIds } }  // Context
                ]
            }).select('requester recipient status').lean()
        ]);

        const photoMap = new Map();
        photoRequests.forEach(req => {
            photoMap.set(req.targetUser.toString(), req.status);
            if (req.status === 'granted') grantedUserIds.add(req.targetUser.toString());
        });

        const connectionMap = new Map();
        connectionRequests.forEach(req => {
            const otherId = req.requester.toString() === myId ? req.recipient.toString() : req.requester.toString();
            connectionMap.set(otherId, req.status);
            // Friends get access too!
            if (req.status === 'accepted') grantedUserIds.add(otherId);
        });

        const startSign = performance.now();

        // 5. Map Data
        const feedData = await Promise.all(visibleUsers.map(async user => {
            const userObj = user;
            let photos = userObj.photos || [];

            // Sort photos: Profile first
            photos.sort((a, b) => (b.isProfile ? 1 : 0) - (a.isProfile ? 1 : 0));

            const hasAccess = isAdmin || grantedUserIds.has(userObj._id.toString());
            const userIdStr = userObj._id.toString();

            // Process URLs (Presign - OPTIMIZED)
            photos = await Promise.all(photos.map(async (photo, index) => {
                // Determine if restricted
                const isRestricted = !hasAccess && index !== 0 && photos.length > 1;

                let targetKey = photo.key;
                if (isRestricted) {
                    if (photo.key && photo.key.includes('_orig.webp')) {
                        targetKey = photo.key.replace('_orig.webp', '_blur.webp');
                    }
                }

                let signedUrl = null;
                // Sign ALL photos because FeedItem uses a Carousel
                if (targetKey) {
                    signedUrl = await getPreSignedUrl(targetKey);
                }

                const finalUrl = signedUrl || photo.url; // Use signed or fallback (probably null/expired for >0)

                return {
                    ...photo,
                    url: finalUrl,
                    restricted: isRestricted
                };
            }));

            // Use the signed URL from the processed photos array (sorted with profile first)
            const signedProfilePhoto = photos.length > 0 ? photos[0].url : null;

            // Calculate Age
            let age = null;
            if (userObj.dob) {
                const diff = Date.now() - new Date(userObj.dob).getTime();
                age = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
            }

            return {
                _id: userObj._id,
                username: userObj.username,
                first_name: userObj.first_name,
                last_name: userObj.last_name,
                profilePhoto: signedProfilePhoto || userObj.profilePhoto, // Fallback to DB value if processing fails
                bio: userObj.bio,
                photos: photos,
                role: userObj.role,
                connectionStatus: connectionMap.get(userIdStr) || 'none',
                photoRequestStatus: photoMap.get(userIdStr) || 'none',

                // Demographic Data
                age: age,
                height: userObj.height,
                city: userObj.city,
                caste: userObj.caste,
                religion: userObj.religion,
                education: userObj.highest_education,
                occupation: userObj.occupation,
                income: userObj.annual_income,
                marital_status: userObj.marital_status
            };
        }));

        const endSign = performance.now();
        const signTime = (endSign - startSign).toFixed(2);
        const totalTime = (performance.now() - startTotal).toFixed(2);

        res.set('Server-Timing', `sign;dur=${signTime}, total;dur=${totalTime}`);

        res.status(200).json({
            success: true,
            data: feedData,
        });

    } catch (error) {
        logger.error('Get Feed Error', { user: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Search Users with Filters
// @route   GET /api/users/search
// @access  Private
exports.searchUsers = async (req, res) => {
    try {
        const {
            minAge, maxAge,
            religion, community,
            state, city,
            marital_status,
            minHeight, maxHeight,
            mother_tongue,
            eating_habits, smoking_habits, drinking_habits,
            highest_education, annual_income, occupation,

            // Property Filters
            land_component, // Text fallback (Deprecated)
            minLandArea, maxLandArea, // Numeric Range
            property_type,
            brothers, sisters, // Family filters
            sortBy,
            vendor_status, // New Filter
            has_products, // New Filter: Only show vendors with products
            q, // Generic Search Query
            page = 1, limit = 20
        } = req.query;

        const query = {
            status: 'active',
            role: { $ne: 'franchise' }, // Exclude franchise accounts
            // is_profile_complete: true, // REMOVED: Managed conditionally below
            $or: [
                { 'photos.0': { $exists: true } },
                { profilePhoto: { $ne: null } }
            ]
        };

        // If user is logged in, exclude self and blocked users
        if (req.user) {
            query._id = {
                $ne: req.user._id,
                $nin: req.user.blockedUsers || []
            };
        }

        if (vendor_status) {
            query.vendor_status = vendor_status;
        }

        // Only enforce profile completion for non-vendors or non-active vendors
        // This allows 'active' vendors (who might be manually approved) to appear even if data is missing
        if (vendor_status !== 'active') {
            query.is_profile_complete = true;
        }

        // --- Has Products Filter (Vendor Specific) ---
        if (has_products === 'true') {
            const Product = require('../models/Product');
            // Find all unique vendors who have at least one active product
            const activeVendors = await Product.distinct('vendor', { isActive: true });

            // Merge with existing _id filter
            if (query._id) {
                query._id.$in = activeVendors;
            } else {
                query._id = { $in: activeVendors };
            }
        }

        // --- Generic Text Search ---
        if (q) {
            const regex = new RegExp(q, 'i');
            if (!query.$and) query.$and = [];
            query.$and.push({
                $or: [
                    { username: regex },
                    { first_name: regex },
                    { last_name: regex },
                    { bio: regex },
                    { city: regex },
                    { state: regex },
                    { occupation: regex },
                    { 'vendor_details.business_name': regex },
                    { 'vendor_details.service_type': regex }
                ]
            });
        }

        // --- Age Filter ---
        if (minAge || maxAge) {
            const today = new Date();
            const dobQuery = {};
            if (maxAge) {
                const date = new Date(today.getFullYear() - parseInt(maxAge) - 1, today.getMonth(), today.getDate());
                dobQuery.$gte = date;
            }
            if (minAge) {
                const date = new Date(today.getFullYear() - parseInt(minAge), today.getMonth(), today.getDate());
                dobQuery.$lte = date;
            }
            if (Object.keys(dobQuery).length > 0) query.dob = dobQuery;
        }

        // --- Family Filters ---
        if (brothers) query.brothers = parseInt(brothers);
        if (sisters) query.sisters = parseInt(sisters);

        // --- Personal ---
        if (religion && religion !== 'Any') query.religion = { $regex: religion, $options: 'i' };
        if (community) query.community = { $regex: community, $options: 'i' };
        if (mother_tongue) query.mother_tongue = { $regex: mother_tongue, $options: 'i' };
        if (marital_status && marital_status !== 'Any') query.marital_status = { $regex: marital_status, $options: 'i' };

        // --- Location (Comprehensive Search) ---
        if (state || city || req.query.country) {
            const locTerm = city || state || req.query.country;
            const locRegex = new RegExp(locTerm, 'i');

            if (!query.$and) query.$and = [];
            query.$and.push({
                $or: [
                    { city: locRegex },
                    { state: locRegex },
                    { country: locRegex },
                    { 'vendor_details.city': locRegex },
                    { 'vendor_details.state': locRegex },
                    { 'vendor_details.business_address': locRegex }
                ]
            });
        }

        // --- Professional & Category Normalization ---
        if (highest_education) query.highest_education = { $regex: highest_education, $options: 'i' };
        if (annual_income && annual_income !== 'Any') query.annual_income = { $regex: annual_income, $options: 'i' };

        if (occupation) {
            // Normalize Search Terms
            let searchRegex = new RegExp(occupation, 'i');
            const term = occupation.toLowerCase();

            if (term.includes('photo')) {
                searchRegex = /photo|camera/i;
            } else if (term.includes('jewel')) {
                searchRegex = /jewel/i;
            } else if (term.includes('decor')) {
                searchRegex = /decor/i;
            } else if (term.includes('makeup') || term.includes('make up')) {
                searchRegex = /makeup|make up|artist/i;
            } else if (term.includes('cater') || term.includes('food')) {
                searchRegex = /cater|food|cook/i;
            } else if (term.includes('music') || term.includes('dj')) {
                searchRegex = /music|dj|sound/i;
            }

            // Search in both occupation AND vendor_details.service_type
            if (!query.$and) query.$and = [];
            query.$and.push({
                $or: [
                    { occupation: searchRegex },
                    { 'vendor_details.service_type': searchRegex },
                    { 'vendor_details.description': searchRegex } // Also check description
                ]
            });
        }

        // --- Lifestyle ---
        if (eating_habits && eating_habits !== 'Any') query.eating_habits = { $regex: eating_habits, $options: 'i' };
        if (smoking_habits && smoking_habits !== 'Any') query.smoking_habits = { $regex: smoking_habits, $options: 'i' };
        if (drinking_habits && drinking_habits !== 'Any') query.drinking_habits = { $regex: drinking_habits, $options: 'i' };

        // --- Property / Land Filters ---
        if (property_type) query.property_types = { $in: [new RegExp(property_type, 'i')] };
        if (minLandArea || maxLandArea) {
            query.land_area = {};
            if (minLandArea) query.land_area.$gte = parseFloat(minLandArea);
            if (maxLandArea) query.land_area.$lte = parseFloat(maxLandArea);
        }

        // --- Height ---
        if (minHeight) query.height = { ...query.height, $gte: minHeight };
        if (req.query.height) query.height = req.query.height;

        // --- Sorting ---
        let sortOption = { created_at: -1 };
        if (sortBy === 'age_asc') sortOption = { dob: -1 };
        if (sortBy === 'age_desc') sortOption = { dob: 1 };

        // --- Execute ---
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const users = await User.find(query)
            .select('username first_name last_name profilePhoto photos bio dob religion city state height occupation land_area property_types vendor_details')
            .sort(sortOption)
            .skip(skip)
            .limit(parseInt(limit));

        const total = await User.countDocuments(query);

        // --- Map Display Data & FETCH PRODUCTS ---
        const Product = require('../models/Product');

        const data = await Promise.all(users.map(async user => {
            let age = null;
            if (user.dob) {
                const diff = Date.now() - user.dob.getTime();
                age = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
            }

            // Fetch Top 3 Products for Vendor
            let products = [];
            if (vendor_status === 'active' || user.role === 'vendor') {
                try {
                    // Assuming products have images. We want to show product images.
                    // Fetch top 4 active products
                    const vendorProducts = await Product.find({
                        vendor: user._id,
                        isActive: true
                    })
                        .select('name price images')
                        .limit(4);

                    // Sign product images if they are S3 keys
                    products = await Promise.all(vendorProducts.map(async p => {
                        let imageUrl = null;
                        if (p.images && p.images.length > 0) {
                            const keyOrUrl = p.images[0];
                            if (!keyOrUrl.startsWith('http')) {
                                try {
                                    imageUrl = await getPreSignedUrl(keyOrUrl);
                                } catch (e) { }
                            } else {
                                imageUrl = keyOrUrl;
                            }
                        }
                        return {
                            _id: p._id,
                            name: p.name,
                            price: p.price,
                            image: imageUrl
                        };
                    }));

                } catch (err) {
                    console.error('Error fetching vendor products for search:', err);
                }
            }

            // Get Profile Photo URL (Presigned)
            let profileUrl = user.profilePhoto;

            // Try to find profile photo obj first
            const profilePhotoObj = user.photos?.find(p => p.url === user.profilePhoto) || (user.photos?.[0]);

            if (profilePhotoObj && profilePhotoObj.key) {
                const signed = await getPreSignedUrl(profilePhotoObj.key);
                if (signed) profileUrl = signed;
            } else if (typeof user.profilePhoto === 'string' && user.profilePhoto.includes('weedingzon/')) {
                try {
                    let key = user.profilePhoto;
                    if (key.startsWith('http')) {
                        const parts = key.split('.com/');
                        if (parts.length > 1) key = parts[1];
                    }
                    const signed = await getPreSignedUrl(key);
                    if (signed) profileUrl = signed;
                } catch (err) { }
            }

            return {
                _id: user._id,
                username: user.username,
                displayName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username,
                profilePhoto: profileUrl || null,
                age,
                religion: user.religion,
                city: user.city,
                state: user.state,
                occupation: user.occupation,
                land_area: user.land_area,
                vendor_details: user.vendor_details,
                products: products // Attached Top Products
            };
        }));

        res.status(200).json({
            success: true,
            data,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / parseInt(limit))
            }
        });

    } catch (error) {
        logger.error('Search Users Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Upload Photos (S3 Twin-Upload)
// @route   POST /api/users/upload-photos
// @access  Private
// @desc    Upload Photos (S3 Twin-Upload)
// @route   POST /api/users/upload-photos
// @access  Private
exports.uploadPhotos = async (req, res) => {
    const startTotal = performance.now();
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No files uploaded' });
        }

        const user = await User.findById(req.user._id);
        if (user.photos.length + req.files.length > 10) {
            return res.status(400).json({ message: 'Maximum 10 photos allowed' });
        }

        logger.info(`Starting Upload for ${req.user.username}: ${req.files.length} files`);

        const successUploads = [];
        const failedUploads = [];

        const path = require('path');
        // ... inside uploadPhotos ...
        // Defined allowed types
        const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

        const processFile = async (file, index) => {
            const fileStart = performance.now();
            try {
                // Strict MIME Type Validation
                if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
                    throw new Error('Invalid file type. Only JPG, PNG, and WEBP are allowed.');
                }

                const fileId = uuidv4();
                const folderPrefix = 'weedingzon/users';
                // Get extension from original file or mimetype
                const ext = path.extname(file.originalname) || '.jpg';
                const originalKey = `${folderPrefix}/${user._id}/${fileId}_orig${ext}`;
                const blurredKey = `${folderPrefix}/${user._id}/${fileId}_blur.webp`;

                logger.debug(`Processing File ${index + 1}/${req.files.length}: ${file.originalname} Size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);

                // 1. Upload Original RAW (No Processing/Compression)
                const originalBuffer = file.buffer;
                const originalUrl = await uploadLocal(originalBuffer, originalKey, file.mimetype);

                // 2. Process Blurred (Thumbnail)
                const blurredBuffer = await sharp(file.buffer)
                    .rotate() // Auto-rotate for the thumb
                    .resize({ width: 20 })
                    .blur(5)
                    .webp({ quality: 20 })
                    .toBuffer();

                const blurredUrl = await uploadLocal(blurredBuffer, blurredKey, 'image/webp');

                const fileDuration = (performance.now() - fileStart).toFixed(2);
                logger.info(`File Uploaded (Raw) (${fileDuration}ms): ${file.originalname}`);

                return {
                    success: true,
                    data: {
                        url: originalUrl,
                        blurredUrl: blurredUrl,
                        key: originalKey,
                        isProfile: false,
                    }
                };
            } catch (error) {
                let userMsg = error.message;

                // Map technical errors to user friendly messages
                if (error.message.includes('Input buffer contains unsupported image format')) {
                    userMsg = "The image file appears to be corrupted or unsupported.";
                } else if (error.code === 'EntityTooLarge' || error.message.includes('EntityTooLarge')) {
                    userMsg = "File is too large. Please upload smaller images.";
                } else if (error.code === 'AccessDenied') {
                    userMsg = "Server storage permission error. Please contact support.";
                }

                logger.error(`File Processing Failed: ${file.originalname}`, { error: error.message });
                return {
                    success: false,
                    filename: file.originalname,
                    error: userMsg
                };
            }
        };

        // ... inside uploadLocal helper ...
        const uploadLocal = async (buffer, key, contentType = 'image/webp') => { // Add contentType param
            const uploadStart = performance.now();
            try {
                const { PutObjectCommand } = require('@aws-sdk/client-s3');
                const command = new PutObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: key,
                    Body: buffer,
                    ContentType: contentType, // Use dynamic content type
                });
                // Determine which client to use based on user role
                const client = (req.user && req.user.role === 'vendor') ? vendorS3Client : s3Client;
                await client.send(command);
                const duration = (performance.now() - uploadStart).toFixed(2);
                logger.debug(`S3 Upload Success (${duration}ms): ${key}`);
                return `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${key}`;
            } catch (err) {
                console.error('S3 Upload Error Helper:', err);
                throw err;
            }
        };



        // Sequential processing to avoid OOM/CPU choke on parallel large image operations
        const results = [];
        for (let i = 0; i < req.files.length; i++) {
            results.push(await processFile(req.files[i], i));
        }

        results.forEach(result => {
            if (result.success) {
                successUploads.push(result.data);
            } else {
                failedUploads.push({ filename: result.filename, error: result.error });
            }
        });

        if (successUploads.length > 0) {
            // Assign order based on current length + index
            successUploads.forEach((photo, idx) => {
                photo.order = user.photos.length + idx;
            });

            user.photos.push(...successUploads);

            // If no profile photo set, set first one
            if (!user.photos.find(p => p.isProfile) && user.photos.length > 0) {
                user.photos[0].isProfile = true;
                user.profilePhoto = user.photos[0].url;
            }

            await user.save();
            const totalDuration = (performance.now() - startTotal).toFixed(2);
            logger.info(`Upload Complete (${totalDuration}ms): ${successUploads.length} success, ${failedUploads.length} failed`);
        } else {
            logger.warn(`S3 Photos Upload Failed: ${req.user.username} (All ${failedUploads.length} failed)`);
        }

        // Generate Presigned URLs for the response (only for the updated/current photo list)
        const responsePhotos = await Promise.all(user.photos.map(async (p) => {
            const pObj = p.toObject();
            if (pObj.key) {
                try {
                    const signed = await getPreSignedUrl(pObj.key);
                    if (signed) pObj.url = signed;
                } catch (e) { }
            }
            return pObj;
        }));

        res.status(200).json({
            success: successUploads.length > 0,
            message: successUploads.length > 0
                ? (failedUploads.length > 0 ? `Uploaded ${successUploads.length} photos. ${failedUploads.length} failed.` : 'Photos uploaded successfully')
                : 'Failed to upload photos',
            data: responsePhotos,
            errors: failedUploads
        });

    } catch (error) {
        logger.error('S3 Upload Error', { user: req.user.username, error: error.message });
        res.status(500).json({ message: 'Upload failed', error: error.message });
    }
};

// uploadCoverPhoto logic removed per user request

// @desc    Get User By Username (Standardized Errors)
// @route   GET /api/users/:username
// @access  Private 
// @desc    Get User By Username (Standardized Errors)
// @route   GET /api/users/:username
// @access  Private 
exports.getUserProfile = async (req, res) => {
    try {
        const identifier = req.params.username;
        const currentUser = req.user;

        // resolveUser handles both ObjectId (for ID) and String (for Username)
        let user;
        try {
            user = await resolveUser(identifier);
            // Select fields (manually since resolveUser might not have select)
            user = await User.findById(user._id).select('-password -__v');
        } catch (e) {
            return res.status(404).json({
                message: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }

        // Check if banned or suspended
        if (user.status === 'banned' || user.status === 'suspended') {
            return res.status(403).json({
                message: 'This account has been suspended or banned.',
                code: user.status === 'banned' ? 'USER_BANNED' : 'USER_SUSPENDED'
            });
        }

        const userObj = user.toObject({ flattenMaps: true });
        const isMe = currentUser._id.toString() === userObj._id.toString();
        const isAdmin = ['admin', 'superadmin'].includes(currentUser.role);

        let accessGranted = isMe || isAdmin;

        // If not me/admin, check permissions
        if (!accessGranted) {
            const [connection, photoRequest] = await Promise.all([
                ConnectionRequest.findOne({
                    $or: [
                        { requester: currentUser._id, recipient: userObj._id, status: 'accepted' },
                        { requester: userObj._id, recipient: currentUser._id, status: 'accepted' }
                    ]
                }),
                PhotoAccessRequest.findOne({
                    requester: currentUser._id,
                    targetUser: userObj._id,
                    status: 'granted'
                })
            ]);

            if (connection || photoRequest) {
                accessGranted = true;
            }
        }

        // Process Photos based on Access
        if (userObj.photos && userObj.photos.length > 0) {
            // Sort: Profile Photo first
            userObj.photos.sort((a, b) => (b.isProfile ? 1 : 0) - (a.isProfile ? 1 : 0));

            userObj.photos = await Promise.all(userObj.photos.map(async (photo) => {
                let keyToSign = photo.key;

                // PRIVACY LOGIC: 
                // If NO Access AND NOT Profile Photo -> Use Blurred Key
                if (!accessGranted && !photo.isProfile && userObj.role !== 'vendor') {
                    if (keyToSign && keyToSign.includes('_orig')) {
                        keyToSign = keyToSign.replace(/_orig\.[^.]+$/, '_blur.webp');
                    }
                }

                let signedUrl = null;
                if (keyToSign) {
                    signedUrl = await getPreSignedUrl(keyToSign);
                }

                return { ...photo, url: signedUrl || photo.url, key: keyToSign };
            }));

            // Sync profilePhoto field
            const profilePhotoObj = userObj.photos.find(p => p.isProfile) || userObj.photos[0];
            if (profilePhotoObj) {
                userObj.profilePhoto = profilePhotoObj.url;
            }
        }

        // --- FETCH PRODUCTS IF VENDOR ---
        if (user.role === 'vendor') {
            const Product = require('../models/Product');
            try {
                const vendorProducts = await Product.find({
                    vendor: user._id,
                    isActive: true
                }).sort({ createdAt: -1 });

                const products = await Promise.all(vendorProducts.map(async (pObj) => {
                    const p = pObj.toObject();
                    let imageUrl = null;
                    if (p.images && p.images.length > 0) {
                        try {
                            imageUrl = await getSignedFileUrl(p.images[0]);
                        } catch (e) {
                            console.error('Product Image Sign Error', e);
                            imageUrl = p.images[0];
                        }
                    }
                    return {
                        _id: p._id,
                        name: p.name,
                        price: p.price,
                        description: p.description,
                        category: p.category,
                        image: imageUrl
                    };
                }));

                userObj.products = products;
            } catch (err) {
                console.error('Error fetching vendor products:', err);
                userObj.products = [];
            }
        }

        res.status(200).json({ success: true, data: userObj });
    } catch (error) {
        logger.error('Get Profile Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get Public Profile Preview (No Auth Required)
// @route   GET /api/users/:username/public-preview
// @access  Public
exports.getPublicProfilePreview = async (req, res) => {
    try {
        const targetUsername = req.params.username;

        const user = await User.findOne({ username: targetUsername })
            .select('first_name last_name username role profilePhoto photos is_profile_complete status');

        if (!user) {
            return res.status(404).json({
                message: 'User not found',
                code: 'USER_NOT_FOUND',
                exists: false
            });
        }

        if (user.status === 'banned' || user.status === 'suspended') {
            return res.status(403).json({
                message: 'This account is unavailable.',
                code: user.status === 'banned' ? 'USER_BANNED' : 'USER_SUSPENDED',
                exists: true
            });
        }

        const userObj = user.toObject({ flattenMaps: true });

        // Sign Only the Profile Photo (others hidden)
        let profilePhotoUrl = userObj.profilePhoto;

        // Try to find the key for profile photo
        if (userObj.photos && userObj.photos.length > 0) {
            const profilePhotoObj = userObj.photos.find(p => p.isProfile) || userObj.photos[0];
            if (profilePhotoObj && profilePhotoObj.key) {
                // If deep linking preview, maybe show blurred if strict privacy? 
                // Usually public profile header is visible. Let's show it signed.
                const signed = await getPreSignedUrl(profilePhotoObj.key);
                if (signed) profilePhotoUrl = signed;
            }
        }

        // Return minimal public info
        const publicProfile = {
            username: userObj.username,
            first_name: userObj.first_name,
            last_name: userObj.last_name, // Maybe hide last name for strict privacy? Let's keep for now.
            profilePhoto: profilePhotoUrl,
            bio: userObj.bio,
            role: userObj.role,
            exists: true,
            is_profile_complete: userObj.is_profile_complete
        };

        res.status(200).json(publicProfile);

    } catch (error) {
        logger.error('Get Public Profile Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Delete Photo
// @route   DELETE /api/users/photos/:photoId
// @access  Private
exports.deletePhoto = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const photoId = req.params.photoId;

        const photoIndex = user.photos.findIndex(p => p._id.toString() === photoId);
        if (photoIndex === -1) {
            return res.status(404).json({ message: 'Photo not found' });
        }

        const photo = user.photos[photoIndex];

        // Delete from S3
        if (photo.key) {
            // Delete Original
            await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: photo.key }));

            // Delete Blurred (Infer key from original if strictly named, or just skip if not stored. 
            // Our logic uses {key}_orig.webp vs {key}_blur.webp, but we stored 'key' as the whole path.
            // Let's try to derive it to ensure clean up.
            if (photo.key.includes('_orig')) {
                const blurKey = photo.key.replace(/_orig\.[^.]+$/, '_blur.webp');
                try {
                    await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: blurKey }));
                } catch (e) {
                    logger.warn('Failed to delete blur key', { key: blurKey });
                }
            }
        }
        // Backward compat: Cloudinary
        // else if (photo.publicId) { ... } 

        user.photos.splice(photoIndex, 1);

        // Reset profile photo if needed
        if (photo.isProfile) {
            user.profilePhoto = null;
            if (user.photos.length > 0) {
                user.photos[0].isProfile = true;
                user.profilePhoto = user.photos[0].url;
            }
        }

        await user.save();

        // Generate Presigned URLs for response
        const responsePhotos = await Promise.all(user.photos.map(async (p) => {
            const pObj = p.toObject();
            if (pObj.key) {
                const signed = await getPreSignedUrl(pObj.key);
                if (signed) pObj.url = signed;
            }
            return pObj;
        }));

        res.status(200).json({
            success: true,
            message: 'Photo deleted',
            data: responsePhotos
        });

    } catch (error) {
        logger.error('Delete Photo Error', { user: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Set Cover Photo (From Gallery)
// @route   PATCH /api/users/photos/:photoId/set-cover
// @access  Private
exports.setCoverPhoto = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const photoId = req.params.photoId;

        const photo = user.photos.id(photoId);
        if (!photo) {
            return res.status(404).json({ message: 'Photo not found' });
        }

        // Reset others
        user.photos.forEach(p => p.isCover = false);

        // Set new
        photo.isCover = true;
        user.coverPhoto = photo.url; // Update cache

        await user.save();

        // Resign URLs for response
        const responsePhotos = await Promise.all(user.photos.map(async (p) => {
            const pObj = p.toObject();
            if (pObj.key) {
                try {
                    const signed = await getPreSignedUrl(pObj.key);
                    if (signed) pObj.url = signed;
                } catch (e) { }
            }
            return pObj;
        }));

        res.status(200).json({
            success: true,
            data: responsePhotos,
            message: 'Cover photo set successfully'
        });
    } catch (error) {
        logger.error('Set Cover Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Set Profile Photo
// @route   PATCH /api/users/photos/:photoId/set-profile
// @access  Private
exports.setProfilePhoto = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const photoId = req.params.photoId;

        const photo = user.photos.find(p => p._id.toString() === photoId);
        if (!photo) {
            return res.status(404).json({ message: 'Photo not found' });
        }

        user.photos.forEach(p => p.isProfile = false);
        photo.isProfile = true;
        user.profilePhoto = photo.url;

        // Reorder: Move profile photo to index 0
        const photoIndex = user.photos.indexOf(photo);
        if (photoIndex > -1) {
            user.photos.splice(photoIndex, 1);
            user.photos.unshift(photo);
        }

        await user.save();


        // Generate Presigned URLs for response
        const responsePhotos = await Promise.all(user.photos.map(async (p) => {
            const pObj = p.toObject();
            if (pObj.key) {
                const signed = await getPreSignedUrl(pObj.key);
                if (signed) pObj.url = signed;
            }
            return pObj;
        }));

        res.status(200).json({
            success: true,
            data: responsePhotos
        });

    } catch (error) {
        logger.error('Set Profile Photo Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Record Profile View
// @route   POST /api/users/view/:userId
// @access  Private
exports.recordProfileView = async (req, res) => {
    try {
        const targetUserId = req.params.userId;
        const viewerId = req.user._id;

        if (targetUserId === viewerId.toString()) {
            return res.status(200).json({ message: 'Self view ignored' });
        }

        // Check if viewed in last 24 hours
        const lastView = await ProfileView.findOne({
            viewer: viewerId,
            profileOwner: targetUserId,
            viewedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        });

        if (!lastView) {
            await ProfileView.create({
                viewer: viewerId,
                profileOwner: targetUserId
            });

            // Send Notification
            notifyUser(targetUserId, {
                title: 'New Profile Visitor',
                body: `${req.user.first_name} visited your profile.`,
                type: 'profile_view',
                data: { userId: viewerId } // Deep link data
            });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Record View Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get Who Viewed My Profile
// @route   GET /api/users/viewers
// @access  Private
exports.getProfileViewers = async (req, res) => {
    try {
        const views = await ProfileView.find({ profileOwner: req.user._id })
            .populate('viewer', 'first_name last_name username profilePhoto bio')
            .sort({ viewedAt: -1 })
            .limit(50); // Limit to recent 50

        // Sign Photos
        const data = await Promise.all(views.map(async (v) => {
            const viewer = v.viewer;
            if (!viewer) return null; // Handle deleted users

            let signedPhoto = null;
            if (viewer.profilePhoto) {
                signedPhoto = await getSignedFileUrl(viewer.profilePhoto);
            }

            return {
                _id: v._id,
                viewer: {
                    _id: viewer._id,
                    username: viewer.username,
                    displayName: viewer.first_name,
                    profilePhoto: signedPhoto,
                    bio: viewer.bio
                },
                viewedAt: v.viewedAt,
                isRead: v.isRead || false
            };
        }));

        res.status(200).json({ success: true, data: data.filter(d => d) });
    } catch (error) {
        logger.error('Get Viewers Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Mark Profile Views as Read
// @route   POST /api/users/viewers/mark-read
// @access  Private
exports.markProfileViewsAsRead = async (req, res) => {
    try {
        await ProfileView.updateMany(
            { profileOwner: req.user._id, isRead: false },
            { $set: { isRead: true } }
        );
        res.status(200).json({ success: true, message: 'Marked as read' });
    } catch (error) {
        logger.error('Mark Read Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

exports.updateLocation = async (req, res) => {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
        return res.status(400).json({ message: 'Latitude and Longitude are required' });
    }

    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        user.location = {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)] // GeoJSON is [lng, lat]
        };

        await user.save();
        res.status(200).json({ message: 'Location updated', location: user.location });
    } catch (error) {
        logger.error('Update Location Error', { error: error.message });
        res.status(500).json({ message: 'Failed to update location' });
    }
};

exports.getNearbyUsers = async (req, res) => {
    const { latitude, longitude, radius = 50, viewAs } = req.query; // Radius in KM

    if (!latitude || !longitude) {
        return res.status(400).json({ message: 'Latitude and Longitude are required' });
    }

    try {
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);
        const maxDistMeters = parseInt(radius) * 1000;

        // Context User (Defaults to logged-in user)
        let currentUser = req.user;

        // Franchise "View As" Logic
        if (req.user.role === 'franchise' && viewAs) {
            const member = await User.findOne({ _id: viewAs, created_by: req.user._id });
            if (member) {
                currentUser = member;
            }
        }

        // Base Query
        const query = {
            status: 'active',
            role: { $ne: 'franchise' }, // Exclude franchise accounts
            _id: { $ne: new mongoose.Types.ObjectId(currentUser._id) },
            is_profile_complete: true
        };

        // Apply Preferences
        const prefs = currentUser.partner_preferences;
        // Helper to get pref value whether Map or Object
        const getPref = (key) => {
            if (!prefs) return null;
            return (typeof prefs.get === 'function') ? prefs.get(key) : prefs[key];
        };

        if (prefs) {
            // 1. Age
            const minAge = getPref('minAge');
            const maxAge = getPref('maxAge');
            if (minAge || maxAge) {
                const today = new Date();
                const dobQuery = {};
                if (maxAge) {
                    const date = new Date(today.getFullYear() - parseInt(maxAge) - 1, today.getMonth(), today.getDate());
                    dobQuery.$gte = date;
                }
                if (minAge) {
                    const date = new Date(today.getFullYear() - parseInt(minAge), today.getMonth(), today.getDate());
                    dobQuery.$lte = date;
                }
                if (Object.keys(dobQuery).length > 0) query.dob = dobQuery;
            }

            // 2. Religion
            const religion = getPref('religion');
            if (religion && religion !== 'Any') query.religion = religion;

            // 3. Community
            const community = getPref('community');
            if (community) query.community = { $regex: community, $options: 'i' };

            // 4. Marital Status
            const maritalStatus = getPref('marital_status');
            if (maritalStatus && maritalStatus !== 'Any') query.marital_status = maritalStatus;

            // 5. Diet
            const diet = getPref('eating_habits');
            if (diet && diet !== 'Any') query.eating_habits = diet;

            // 6. Smoking
            const smoking = getPref('smoking_habits');
            if (smoking && smoking !== 'Any') query.smoking_habits = smoking;

            // 7. Drinking
            const drinking = getPref('drinking_habits');
            if (drinking && drinking !== 'Any') query.drinking_habits = drinking;

            // 8. Education
            const education = getPref('highest_education');
            if (education) query.highest_education = { $regex: education, $options: 'i' };

            // 9. Occupation
            const occupation = getPref('occupation');
            if (occupation) query.occupation = { $regex: occupation, $options: 'i' };

            // 10. Income
            const income = getPref('annual_income');
            if (income && income !== 'Any') query.annual_income = { $regex: income, $options: 'i' };
        }

        // Use aggregation to get distance and user data
        const users = await User.aggregate([
            {
                $geoNear: {
                    near: { type: 'Point', coordinates: [lng, lat] },
                    distanceField: 'distance', // Meters
                    maxDistance: maxDistMeters,
                    spherical: true,
                    key: 'location', // Explicitly specify the index key
                    query: query
                }
            },
            { $limit: 100 },
            {
                $project: {
                    first_name: 1,
                    last_name: 1,
                    dob: 1,
                    gender: 1,
                    religion: 1,
                    occupation: 1,
                    profilePhoto: 1,
                    location: 1,
                    about_me: 1,
                    username: 1,
                    distance: 1, // Include calculated distance
                    photos: 1 // Include photos for fallback
                }
            }
        ]);

        // Post-process: Add Jitter for Privacy and Sign URLs
        // +/- 0.005 degrees is approx +/- 500 meters
        const JITTER_RANGE = 0.005;

        const sanitizedUsers = await Promise.all(users.map(async (user) => {
            if (user.location && user.location.coordinates) {
                const [exactLng, exactLat] = user.location.coordinates;

                // Add random noise
                const jitterLat = exactLat + (Math.random() - 0.5) * JITTER_RANGE;
                const jitterLng = exactLng + (Math.random() - 0.5) * JITTER_RANGE;

                user.location.coordinates = [jitterLng, jitterLat];
            }

            // Sign Profile Photo
            if (user.photos && user.photos.length > 0) {
                // Find profile photo object (matching the stored URL or just the one marked isProfile/first)
                // Since aggregation doesn't guarantee full object methods, we can't reliably trust helper methods.
                // But we have the 'photos' array from projection.
                const profilePhotoObj = user.photos.find(p => p.url === user.profilePhoto) || user.photos[0];

                if (profilePhotoObj && profilePhotoObj.key) {
                    try {
                        const signed = await getPreSignedUrl(profilePhotoObj.key);
                        if (signed) user.profilePhoto = signed;
                    } catch (e) {
                        // Keep original if signing fails
                    }
                }
            }

            delete user.photos; // Don't send full photo array for map usage
            return user;
        }));

        res.status(200).json({
            success: true,
            data: sanitizedUsers
        });

    } catch (error) {
        logger.error('Get Nearby Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
// @desc    Block User
// @route   POST /api/users/block
// @access  Private
exports.blockUser = async (req, res) => {
    try {
        const { targetUsername } = req.body;
        // Re-fetch user to get Mongoose Document (middleware uses lean())
        const currentUser = await User.findById(req.user._id);
        if (!currentUser) return res.status(401).json({ message: 'User not found' });

        if (!targetUsername) return res.status(400).json({ message: 'Username required' });
        if (targetUsername === currentUser.username) return res.status(400).json({ message: 'Cannot block yourself' });

        const targetUser = await User.findOne({ username: targetUsername });
        if (!targetUser) return res.status(404).json({ message: 'User not found' });

        // Helper to ensure blockedUsers array exists
        if (!currentUser.blockedUsers) currentUser.blockedUsers = [];

        // Add to blockedUsers if not present
        if (!currentUser.blockedUsers.includes(targetUser._id)) {
            currentUser.blockedUsers.push(targetUser._id);
            await currentUser.save();
        }

        // Remove any connection
        await ConnectionRequest.findOneAndDelete({
            $or: [
                { requester: currentUser._id, recipient: targetUser._id },
                { requester: targetUser._id, recipient: currentUser._id }
            ]
        });

        // Remove access requests
        await Promise.all([
            PhotoAccessRequest.deleteMany({
                $or: [
                    { requester: currentUser._id, targetUser: targetUser._id },
                    { requester: targetUser._id, targetUser: currentUser._id }
                ]
            }),
            DetailsAccessRequest.deleteMany({
                $or: [
                    { requester: currentUser._id, targetUser: targetUser._id },
                    { requester: targetUser._id, targetUser: currentUser._id }
                ]
            })
        ]);

        logger.info(`User Blocked: ${currentUser.username} blocked ${targetUser.username}`);
        res.status(200).json({ success: true, message: 'User blocked' });

    } catch (error) {
        logger.error('Block User Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Unblock User
// @route   POST /api/users/unblock
// @access  Private
exports.unblockUser = async (req, res) => {
    try {
        const { targetUsername } = req.body;
        // Re-fetch user to get Mongoose Document (middleware uses lean())
        const currentUser = await User.findById(req.user._id);
        if (!currentUser) return res.status(401).json({ message: 'User not found' });

        const targetUser = await User.findOne({ username: targetUsername });
        if (!targetUser) return res.status(404).json({ message: 'User not found' });

        if (!currentUser.blockedUsers) currentUser.blockedUsers = [];
        currentUser.blockedUsers = currentUser.blockedUsers.filter(id => id.toString() !== targetUser._id.toString());
        await currentUser.save();

        logger.info(`User Unblocked: ${currentUser.username} unblocked ${targetUser.username}`);
        res.status(200).json({ success: true, message: 'User unblocked' });

    } catch (error) {
        logger.error('Unblock User Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get Blocked Users
// @route   GET /api/users/blocked-users
// @access  Private
exports.getBlockedUsers = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate('blockedUsers', 'first_name last_name username profilePhoto');

        // Sign photos if needed (assuming profilePhoto needs signing)
        // Re-using logic or just sending URL. Usually ProfilePhoto is S3 URL.
        const blockedList = await Promise.all(user.blockedUsers.map(async (u) => {
            const uObj = u.toObject();
            // Basic signing attempt if it's a key not full URL, but typically profilePhoto is full URL in DB 
            // unless we changed it. Let's assume it's URL or needs no signing for now OR
            // better: attempt signing if it looks like a key?
            // Existing logic often saves full URL. 
            // Wait, existing logic in `setProfilePhoto` saves `photo.url`.
            // So we can just return it.
            return {
                _id: uObj._id,
                username: uObj.username,
                displayName: [uObj.first_name, uObj.last_name].filter(Boolean).join(' ') || uObj.username,
                profilePhoto: uObj.profilePhoto
            };
        }));

        res.status(200).json({ success: true, data: blockedList });
    } catch (error) {
        logger.error('Get Blocked Users Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Report User
// @route   POST /api/users/report
// @access  Private
exports.reportUser = async (req, res) => {
    try {
        const { targetUsername, reason, description } = req.body;
        const currentUser = req.user;

        const targetUser = await User.findOne({ username: targetUsername });
        if (!targetUser) return res.status(404).json({ message: 'User not found' });

        const report = await Report.create({
            reporter: currentUser._id,
            reportedUser: targetUser._id,
            reason,
            description
        });

        // Add to User's reports array? (Optional, if we want quick access from User doc)
        if (!targetUser.reports) targetUser.reports = [];
        targetUser.reports.push(report._id);
        await targetUser.save();

        // Notify Admin (Optional: Email or Push to Admin)
        // For now just log
        logger.warn(`User Reported: ${currentUser.username} reported ${targetUser.username} for ${reason}`);

        res.status(201).json({ success: true, message: 'Report submitted' });
    } catch (error) {
        logger.error('Report User Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Update Partner Preferences
// @route   PUT /api/users/preferences
// @access  Private
exports.updatePartnerPreferences = async (req, res) => {
    try {
        const { preferences } = req.body;
        if (!preferences) {
            return res.status(400).json({ message: 'Preferences data is required' });
        }

        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Update preferences correctly for Mongoose Map
        if (!user.partner_preferences) {
            user.partner_preferences = new Map();
        }

        // Iterate and set individually to avoid spreading internal Mongoose properties
        for (const [key, value] of Object.entries(preferences)) {
            // Ensure values are stored as strings (matching schema: of: String)
            if (value !== undefined && value !== null) {
                user.partner_preferences.set(key, String(value));
            }
        }

        await user.save();

        res.status(200).json({
            success: true,
            message: 'Preferences updated successfully',
            data: user.partner_preferences
        });

    } catch (error) {
        logger.error('Update Preferences Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
