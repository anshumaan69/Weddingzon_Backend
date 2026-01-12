const User = require('../models/User');
const PhotoAccessRequest = require('../models/PhotoAccessRequest');
const cloudinary = require('../config/cloudinary');

// @desc    Get Feed Users (Users with photos)
// @route   GET /api/users/feed
// @access  Private
exports.getFeed = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const query = {
            status: 'active',
            _id: { $ne: req.user._id }, // Exclude current user
            $or: [
                { 'photos.0': { $exists: true } },
                { profilePhoto: { $ne: null } }
            ]
        };

        const users = await User.find(query)
            .select('username first_name last_name profilePhoto photos bio created_at role')
            .sort({ updated_at: -1 })
            .skip(skip)
            .limit(limit);

        let grantedUserIds = new Set();
        const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

        if (!isAdmin) {
            const grantedRequests = await PhotoAccessRequest.find({
                requester: req.user.id,
                status: 'granted',
                targetUser: { $in: users.map(u => u._id) }
            }).select('targetUser');

            grantedRequests.forEach(req => grantedUserIds.add(req.targetUser.toString()));
        }

        const feedData = users.map(user => {
            const userObj = user.toObject();
            let photos = userObj.photos || [];

            photos.sort((a, b) => (b.isProfile ? 1 : 0) - (a.isProfile ? 1 : 0));

            const hasAccess = isAdmin || grantedUserIds.has(userObj._id.toString());

            if (!hasAccess && photos.length > 1) {
                photos = photos.map((photo, index) => {
                    if (index === 0) return photo;

                    let blurredUrl = '';
                    if (photo.url && photo.url.includes('cloudinary.com')) {
                        blurredUrl = photo.url.replace('/upload/', '/upload/e_blur:2000,q_1,f_auto/');
                    }

                    return {
                        _id: photo._id,
                        restricted: true,
                        isProfile: photo.isProfile,
                        order: photo.order,
                        url: blurredUrl
                    };
                });
            }

            return {
                _id: userObj._id,
                username: userObj.username,
                // avatar: userObj.avatar, // Renamed/used profilePhoto in our schema
                profilePhoto: userObj.profilePhoto,
                bio: userObj.bio,
                photos: photos,
                role: userObj.role
            };
        });

        res.status(200).json({
            success: true,
            count: feedData.length,
            data: feedData
        });
    } catch (error) {
        console.error('Get Feed Error:', error);
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
        if (user.photos.length + req.files.length > 5) {
            return res.status(400).json({ message: 'Maximum 5 photos allowed' });
        }

        const photoData = [];

        // Process each uploaded file
        for (const file of req.files) {
            // Assuming file buffer is available if using memoryStorage
            // Or path if using diskStorage. Let's use robust Cloudinary upload stream or direct path
            // For simplicity, assuming multer is configured for memory or temp disk
            // Here we use a direct upload (adjust if multer storage differs)

            // NOTE: Since we installed multer but didn't config it yet, we'll assume stream buffer upload
            // But usually it's easier to upload file path if saved to disk.
            // Let's implement stream upload for memory storage which is cleaner for simple VPS

            const b64 = Buffer.from(file.buffer).toString('base64');
            const dataURI = 'data:' + file.mimetype + ';base64,' + b64;

            const result = await cloudinary.uploader.upload(dataURI, {
                folder: 'weddingzon/users',
                resource_type: 'auto',
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

        res.status(200).json({
            success: true,
            message: 'Photos uploaded',
            data: user.photos
        });

    } catch (error) {
        console.error('Upload Error:', error);
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
