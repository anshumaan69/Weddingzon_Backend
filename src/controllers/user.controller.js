const User = require('../models/User');
const PhotoAccessRequest = require('../models/PhotoAccessRequest');
const cloudinary = require('../config/cloudinary');
const logger = require('../utils/logger');
const { compressImage } = require('../utils/compressImage');

// @desc    Get Feed Users (Randomized Cursor Strategy)
// @route   GET /api/users/feed
// @access  Private
exports.getFeed = async (req, res) => {
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

        // Cursor Pagination (Descending by _id/creation)
        if (cursor) {
            query._id = { ...query._id, $lt: cursor };
        }

        // 1. Fetch Candidates
        let users = await User.find(query)
            .select('username first_name last_name profilePhoto photos bio created_at role')
            .sort({ _id: -1 })
            .limit(FETCH_SIZE);

        // Capture next cursor (from the last of the fetched batch, to advance properly)
        const nextCursor = users.length > 0 ? users[users.length - 1]._id : null;

        // 2. Shuffle Logic
        // Simple Fisher-Yates or random sort for small array
        users = users.sort(() => Math.random() - 0.5);

        // 3. Slice Logic
        const visibleUsers = users.slice(0, SHOW_SIZE);

        // 4. Process Permissions (Admin/Connections)
        let grantedUserIds = new Set();
        const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

        if (!isAdmin && visibleUsers.length > 0) {
            const grantedRequests = await PhotoAccessRequest.find({
                requester: req.user.id,
                status: 'granted',
                targetUser: { $in: visibleUsers.map(u => u._id) }
            }).select('targetUser');
            grantedRequests.forEach(req => grantedUserIds.add(req.targetUser.toString()));
        }

        // 5. Map Data
        const feedData = visibleUsers.map(user => {
            const userObj = user.toObject();
            let photos = userObj.photos || [];

            // Sort photos: Profile first
            photos.sort((a, b) => (b.isProfile ? 1 : 0) - (a.isProfile ? 1 : 0));

            const hasAccess = isAdmin || grantedUserIds.has(userObj._id.toString());

            // Apply restrictions
            if (!hasAccess && photos.length > 1) {
                photos = photos.map((photo, index) => {
                    if (index === 0) return photo; // First photo always public

                    let blurredUrl = '';
                    if (photo.url && photo.url.includes('cloudinary.com')) {
                        blurredUrl = photo.url.replace('/upload/', '/upload/e_blur:2000,q_1,f_auto/');
                    }
                    return { ...photo, restricted: true, url: blurredUrl };
                });
            }

            return {
                _id: userObj._id,
                username: userObj.username,
                profilePhoto: userObj.profilePhoto,
                bio: userObj.bio,
                photos: photos,
                role: userObj.role
            };
        });

        // res.status(200).json({ // Removed verbose logging for feed if not debugging
        //     success: true,
        //     data: feedData, // Array of 9 shuffled users
        //     nextCursor      // ID to fetch next batch of 15
        // });

        // Use condensed log
        // logger.info(`Feed Fetched for ${req.user.username}: ${feedData.length} items`);
        res.status(200).json({
            success: true,
            data: feedData,
            nextCursor
        });

    } catch (error) {
        logger.error('Get Feed Error', { user: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Upload Photos (User Profile)
// @route   POST /api/users/upload-photos
// @access  Private
exports.uploadPhotos = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No files uploaded' });
        }

        // Limit check
        const user = await User.findById(req.user.id);
        if (user.photos.length + req.files.length > 10) {
            return res.status(400).json({ message: 'Maximum 10 photos allowed' });
        }

        const photoData = [];

        // Process each uploaded file
        // Process each uploaded file
        for (const file of req.files) {
            // Compress the image buffer
            const compressedBuffer = await compressImage(file.buffer);

            const b64 = compressedBuffer.toString('base64');
            const dataURI = 'data:image/webp;base64,' + b64;

            const result = await cloudinary.uploader.upload(dataURI, {
                folder: 'weddingzon/users',
                resource_type: 'image',
            });

            photoData.push({
                url: result.secure_url,
                publicId: result.public_id,
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

        logger.info(`Photos Uploaded: ${req.user.username} (${req.files.length} files)`);

        res.status(200).json({
            success: true,
            message: 'Photos uploaded',
            data: user.photos
        });

    } catch (error) {
        logger.error('Upload Error', { user: req.user.username, error: error.message });
        res.status(500).json({ message: 'Upload failed' });
    }
};

// @desc    Get User By Username (Public/Private based on logic)
// @route   GET /api/users/:username
// @access  Private (or Public?) 
// Hooc used getUserByUsername from auth.controller - sticking to user.controller here for cleaner split
exports.getUserProfile = async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username })
            .select('-password -__v');

        if (!user) return res.status(404).json({ message: 'User not found' });

        // Apply logic similar to GetFeed for viewing permissions if needed
        // For now return basic profile
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Delete Photo
// @route   DELETE /api/users/photos/:photoId
// @access  Private
exports.deletePhoto = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const photoId = req.params.photoId;

        // Find photo
        const photoIndex = user.photos.findIndex(p => p._id.toString() === photoId);
        if (photoIndex === -1) {
            return res.status(404).json({ message: 'Photo not found' });
        }

        const photo = user.photos[photoIndex];

        // Remove from Cloudinary
        if (photo.publicId) {
            await cloudinary.uploader.destroy(photo.publicId);
        }

        // Remove from array
        user.photos.splice(photoIndex, 1);

        // If deleted photo was profile photo, set new one
        if (photo.isProfile) {
            user.profilePhoto = null; // Reset first
            if (user.photos.length > 0) {
                user.photos[0].isProfile = true;
                user.profilePhoto = user.photos[0].url;
            }
        }

        await user.save();

        res.status(200).json({
            success: true,
            message: 'Photo deleted',
            data: user.photos
        });

    } catch (error) {
        logger.error('Delete Photo Error', { user: req.user.username, photoId: req.params.photoId, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Set Profile Photo
// @route   PATCH /api/users/photos/:photoId/set-profile
// @access  Private
exports.setProfilePhoto = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const photoId = req.params.photoId;

        const photo = user.photos.find(p => p._id.toString() === photoId);
        if (!photo) {
            return res.status(404).json({ message: 'Photo not found' });
        }

        // Reset all to false
        user.photos.forEach(p => p.isProfile = false);

        // Set target to true
        photo.isProfile = true;
        user.profilePhoto = photo.url;

        await user.save();

        res.status(200).json({
            success: true,
            message: 'Profile photo updated',
            data: user.photos
        });

    } catch (error) {
        logger.error('Set Profile Photo Error', { user: req.user.username, error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
