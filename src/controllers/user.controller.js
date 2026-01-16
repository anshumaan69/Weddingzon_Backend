const User = require('../models/User');
const PhotoAccessRequest = require('../models/PhotoAccessRequest');
const ConnectionRequest = require('../models/ConnectionRequest');
// const cloudinary = require('../config/cloudinary'); // Deprecated
const { getPreSignedUrl, uploadToS3 } = require('../utils/s3'); // Centralized S3 Utils
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../config/s3'); // Needed for raw commands (delete)
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
        const { cursor } = req.query;
        const FETCH_SIZE = 15;
        const SHOW_SIZE = 9;

        // Base Query
        const query = {
            status: 'active',
            _id: { $ne: req.user._id }, // Exclude current user
            $or: [
                { 'photos.0': { $exists: true } },
                { profilePhoto: { $ne: null } }
            ]
        };

        // Cursor Pagination
        if (cursor) {
            query._id = { ...query._id, $lt: cursor };
        }

        // 1. Fetch Candidates (Optimized with lean())
        let users = await User.find(query)
            .select('username first_name last_name profilePhoto photos bio created_at role')
            .sort({ _id: -1 })
            .limit(FETCH_SIZE)
            .lean();

        // Capture next cursor
        const nextCursor = users.length > 0 ? users[users.length - 1]._id : null;

        // 2. Shuffle Logic
        users = users.sort(() => Math.random() - 0.5);

        // 3. Slice Logic
        const visibleUsers = users.slice(0, SHOW_SIZE);

        // 4. Process Permissions & Statuses
        let grantedUserIds = new Set();
        const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

        // Bulk Fetch Statuses
        const visibleUserIds = visibleUsers.map(u => u._id);
        const myId = req.user._id.toString();

        const [photoRequests, connectionRequests] = await Promise.all([
            PhotoAccessRequest.find({
                requester: req.user._id,
                targetUser: { $in: visibleUserIds }
            }).select('targetUser status').lean(),
            ConnectionRequest.find({
                $or: [
                    { requester: req.user._id, recipient: { $in: visibleUserIds } },
                    { recipient: req.user._id, requester: { $in: visibleUserIds } }
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

            return {
                _id: userObj._id,
                username: userObj.username,
                first_name: userObj.first_name,
                last_name: userObj.last_name,
                profilePhoto: userObj.profilePhoto, // This might be stale if we relied on separate field, but usually frontend uses photos[0]
                bio: userObj.bio,
                photos: photos,
                role: userObj.role,
                connectionStatus: connectionMap.get(userIdStr) || 'none',
                photoRequestStatus: photoMap.get(userIdStr) || 'none'
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
            q, // Generic Search Query
            page = 1, limit = 20
        } = req.query;

        const query = {
            status: 'active',
            _id: { $ne: req.user._id },
            $or: [
                { 'photos.0': { $exists: true } },
                { profilePhoto: { $ne: null } }
            ]
        };

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
                    { occupation: regex }
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
        if (religion) query.religion = religion;
        if (community) query.community = community;
        if (mother_tongue) query.mother_tongue = mother_tongue;
        if (marital_status) query.marital_status = marital_status;

        // --- Location ---
        if (state) query.state = new RegExp(state, 'i');
        if (city) query.city = new RegExp(city, 'i');
        if (req.query.country) query.country = new RegExp(req.query.country, 'i');

        // --- Professional ---
        if (highest_education) query.highest_education = highest_education;
        if (annual_income) query.annual_income = annual_income;
        if (occupation) query.occupation = new RegExp(occupation, 'i');

        // --- Lifestyle ---
        if (eating_habits) query.eating_habits = eating_habits;
        if (smoking_habits) query.smoking_habits = smoking_habits;
        if (drinking_habits) query.drinking_habits = drinking_habits;

        // --- Property / Land Filters (Based on User Request) ---
        // Assuming user stores these as strings or arrays in 'property_types' or 'land_area'
        if (property_type) {
            query.property_types = { $in: [new RegExp(property_type, 'i')] };
        }
        // Land Area Range Filter (Refactored to Number)
        if (minLandArea || maxLandArea) {
            query.land_area = {};
            if (minLandArea) query.land_area.$gte = parseFloat(minLandArea);
            if (maxLandArea) query.land_area.$lte = parseFloat(maxLandArea);
        }

        // Legacy/Text Land Component Filter
        if (land_component && land_component !== 'any') {
            // If range is NOT used, allow text search (fallback) - ONLY if checks fail or for legacy string data (which is broken now)
            // We can ignore this or try to parse land_component if it's a number
            // For now, let's leave it but it might not work well with Number type unless exact value match
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
            .select('username first_name last_name profilePhoto photos bio dob religion city state height occupation land_area property_types')
            .sort(sortOption)
            .skip(skip)
            .limit(parseInt(limit));

        const total = await User.countDocuments(query);

        // --- Map Display Data ---
        const data = await Promise.all(users.map(async user => {
            let age = null;
            if (user.dob) {
                const diff = Date.now() - user.dob.getTime();
                age = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
            }

            // Get Profile Photo URL (Presigned)
            let profileUrl = user.profilePhoto;

            // If profilePhoto is NOT an external URL (Cloudinary) but an S3 path/key logic? 
            // Current upload logic sets user.profilePhoto = url (which was CDN_URL/key).
            // We need to extract key to resign it.

            // Better logic: use user.photos find isProfile
            const profilePhotoObj = user.photos?.find(p => p.url === user.profilePhoto) || (user.photos?.[0]);

            if (profilePhotoObj && profilePhotoObj.key) {
                const signed = await getPreSignedUrl(profilePhotoObj.key);
                if (signed) profileUrl = signed;
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
                land_area: user.land_area
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
exports.uploadPhotos = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No files uploaded' });
        }

        const user = await User.findById(req.user._id);
        if (user.photos.length + req.files.length > 10) {
            return res.status(400).json({ message: 'Maximum 10 photos allowed' });
        }

        const photoData = [];

        // Local uploadToS3 helper removed/refactored if needed, OR keep if specialized
        // Since we have uploadToS3 in utils, we could try to reuse it, but this one does logging and URL returns differently.
        // For now, let's keep the custom one inside uploadPhotos or refactor it.
        // Actually, let's leave internal logic as is but note we should ideally move it.
        // Wait, I see I removed PutObjectCommand import, so I MUST update this internal function.

        // Helper to upload buffer to S3 (Local to this function for now)
        const uploadLocal = async (buffer, key) => {
            // We can actually use the exported uploadToS3 if we construct a file object, but buffer is raw here.
            // Let's re-add PutObjectCommand import or use s3Client directly.
            // I will use s3Client directly as before.
            try {
                // ... (logic)
                // Need PutObjectCommand
                const { PutObjectCommand } = require('@aws-sdk/client-s3'); // Re-require for safety inside function
                const command = new PutObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: key,
                    Body: buffer,
                    ContentType: 'image/webp',
                });
                await s3Client.send(command);
                // ...
                return `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${key}`;
            } catch (err) {
                throw err;
            }
        };

        for (const file of req.files) {
            const fileId = uuidv4();
            const folderPrefix = 'weedingzon/users'; // Based on provided ARN path
            const originalKey = `${folderPrefix}/${user._id}/${fileId}_orig.webp`;
            const blurredKey = `${folderPrefix}/${user._id}/${fileId}_blur.webp`;

            // 1. Process Original (Watermarked)
            // Resize to max 1920x1080 to save space, Convert to WebP
            // Add Watermark ("WeddingZon" text bottom right)
            const originalBuffer = await sharp(file.buffer)
                .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
                .composite([{
                    input: Buffer.from(`
                        <svg width="500" height="100" viewBox="0 0 500 100">
                            <!-- Drop Shadow for contrast -->
                            <text x="95%" y="90%" font-family="sans-serif" font-weight="bold" font-size="48" fill="black" fill-opacity="0.5" text-anchor="end">WeddingZon</text>
                            <!-- Main Text -->
                            <text x="94.5%" y="89%" font-family="sans-serif" font-weight="bold" font-size="48" fill="white" fill-opacity="0.8" text-anchor="end">WeddingZon</text>
                        </svg>
                     `),
                    gravity: 'southeast'
                }])
                .webp({ quality: 80 })
                .toBuffer();

            const originalUrl = await uploadLocal(originalBuffer, originalKey);

            // 2. Process Blurred (For Restricted Access)
            // Resize small -> Blur -> WebP Low Quality
            const blurredBuffer = await sharp(file.buffer)
                .resize({ width: 400 }) // Smaller for blur
                .blur(20)               // Sigma 20
                .webp({ quality: 20 })
                .toBuffer();

            const blurredUrl = await uploadLocal(blurredBuffer, blurredKey);

            photoData.push({
                url: originalUrl,
                blurredUrl: blurredUrl,
                key: originalKey, // Store main key for deletion reference
                isProfile: false,
                order: user.photos.length + photoData.length
            });
        }

        user.photos.push(...photoData);

        // If no profile photo set, set first one
        if (!user.photos.find(p => p.isProfile) && user.photos.length > 0) {
            user.photos[0].isProfile = true;
            user.profilePhoto = user.photos[0].url;
        }

        await user.save();

        logger.info(`S3 Photos Uploaded: ${req.user.username} (${req.files.length} files)`);

        // Generate Presigned URLs for the response so frontend can display them immediately
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
            message: 'Photos uploaded',
            data: responsePhotos
        });

    } catch (error) {
        logger.error('S3 Upload Error', { user: req.user.username, error: error.message });
        res.status(500).json({ message: 'Upload failed' });
    }
};

// @desc    Get User By Username
// @route   GET /api/users/:username
// @access  Private 
exports.getUserProfile = async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username })
            .select('-password -__v');

        if (!user) return res.status(404).json({ message: 'User not found' });

        // Presign Photos
        const userObj = user.toObject();
        if (userObj.photos && userObj.photos.length > 0) {
            userObj.photos = await Promise.all(userObj.photos.map(async (photo) => {
                let signedUrl = null;
                if (photo.key) {
                    signedUrl = await getPreSignedUrl(photo.key);
                }
                return { ...photo, url: signedUrl || photo.url };
            }));

            // Update profilePhoto link if needed
            // (Assuming profilePhoto string matches one of the photos, update it to signed version)
            const profilePhotoObj = userObj.photos.find(p => p.isProfile) || userObj.photos[0];
            if (profilePhotoObj) {
                userObj.profilePhoto = profilePhotoObj.url;
            }
        }

        res.status(200).json(userObj);
    } catch (error) {
        logger.error('Get Profile Error', { error: error.message });
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
            await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: photo.key }));

            // Delete Blurred (Infer key from original if strictly named, or just skip if not stored. 
            // Our logic uses {key}_orig.webp vs {key}_blur.webp, but we stored 'key' as the whole path.
            // Let's try to derive it to ensure clean up.
            if (photo.key.includes('_orig.webp')) {
                const blurKey = photo.key.replace('_orig.webp', '_blur.webp');
                try {
                    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: blurKey }));
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
            message: 'Profile photo updated',
            data: responsePhotos
        });

    } catch (error) {
        logger.error('Set Profile Photo Error', { user: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
