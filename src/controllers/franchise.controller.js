const User = require('../models/User');
const logger = require('../utils/logger');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { s3Client } = require('../config/s3');
const { getPreSignedUrl } = require('../utils/s3');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const PDFDocument = require('pdfkit');

// Mock Payment & Submit for Approval
exports.submitPayment = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (user.role !== 'franchise') {
            return res.status(403).json({ message: 'Only franchise accounts can perform this action' });
        }

        // Mock Payment Success
        user.franchise_status = 'pending_approval';
        await user.save();

        logger.info(`Franchise Payment Submitted: ${user.username}`);
        res.status(200).json({ success: true, message: 'Payment successful. Waiting for admin approval.', user });
    } catch (error) {
        logger.error('Franchise Payment Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// Create a new Profile (Bride/Groom) under this Franchise
exports.createFranchiseProfile = async (req, res) => {
    try {
        const franchise = await User.findById(req.user._id);
        if (!franchise || franchise.role !== 'franchise' || franchise.franchise_status !== 'active') {
            return res.status(403).json({ message: 'Unauthorized or Franchise not active' });
        }

        const {
            first_name, last_name, email, phone, gender, dob,
            religion, community, password, // Added password
            // ... other essential fields
        } = req.body;

        // Auto-generate username
        const baseUsername = (first_name + (last_name || '')).toLowerCase().replace(/\s+/g, '');
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        const username = `${baseUsername}${randomSuffix}`;

        // Generate Random Password
        const crypto = require('crypto');
        const generatedPassword = password || crypto.randomBytes(4).toString('hex') + Math.floor(Math.random() * 100);

        const newProfile = new User({
            first_name,
            last_name,
            email,
            phone,
            password: generatedPassword,
            gender,
            dob,
            religion,
            community,
            username,
            role: 'member', // Always 'member' as per requirement
            created_by: franchise._id, // LINK TO FRANCHISE
            is_phone_verified: true, // Assuming franchise verified them
            is_profile_complete: false,
        });

        await newProfile.save();

        const responseData = {
            success: true,
            message: 'Profile created successfully',
            profile: newProfile,
            credentials: {
                username: newProfile.username,
                password: generatedPassword
            }
        };

        logger.info(`Franchise ${franchise.username} created profile ${newProfile.username}`);
        res.status(201).json(responseData);

    } catch (error) {
        logger.error('Create Franchise Profile Error', { error: error.message });
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Email/Phone already exists.' });
        }
        res.status(500).json({ message: 'Server Error' });
    }
};

// Get Profiles created by this Franchise
// Get Profiles created by this Franchise
exports.getFranchiseProfiles = async (req, res) => {
    try {
        const profiles = await User.find({ created_by: req.user._id }).sort({ created_at: -1 }).lean();

        // Sign Photo URLs for all profiles
        await Promise.all(profiles.map(async (profile) => {
            if (profile.photos && profile.photos.length > 0) {
                profile.photos = await Promise.all(profile.photos.map(async (p) => {
                    if (p.key) {
                        try {
                            const signed = await getPreSignedUrl(p.key);
                            if (signed) p.url = signed;
                        } catch (e) { }
                    }
                    return p;
                }));

                // Update profilePhoto
                const profilePicObj = profile.photos.find(p => p.isProfile) || profile.photos[0];
                if (profilePicObj) {
                    profile.profilePhoto = profilePicObj.url;
                }
            }
        }));

        res.status(200).json({ success: true, profiles });
    } catch (error) {
        logger.error('Get Franchise Profiles Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// Update Partner Preferences for a specific profile
exports.updateProfilePreferences = async (req, res) => {
    const { profileId } = req.params;
    const { preferences } = req.body; // Object like { minAge: 25, maxAge: 30, community: '...' }

    try {
        const profile = await User.findOne({ _id: profileId, created_by: req.user._id });
        if (!profile) {
            return res.status(404).json({ message: 'Profile not found or not owned by you' });
        }

        // Merge preferences
        // Merge preferences safely into Mongoose Map
        if (!profile.partner_preferences) {
            profile.partner_preferences = new Map();
        }

        Object.keys(preferences).forEach(key => {
            const value = preferences[key];
            if (value === '' || value === null || value === undefined) {
                profile.partner_preferences.delete(key);
            } else {
                profile.partner_preferences.set(key, String(value));
            }
        });
        await profile.save();

        res.status(200).json({ success: true, message: 'Preferences updated', profile });
    } catch (error) {
        logger.error('Update Preferences Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// Get Single Member Profile
// Get Single Member Profile
exports.getMemberProfile = async (req, res) => {
    try {
        const { profileId } = req.params;
        const profile = await User.findOne({ _id: profileId, created_by: req.user._id }).lean();

        if (!profile) {
            return res.status(404).json({ message: 'Profile not found or unauthorized' });
        }

        // Sign Photo URLs (Private S3 Bucket)
        if (profile.photos && profile.photos.length > 0) {
            profile.photos = await Promise.all(profile.photos.map(async (p) => {
                if (p.key) {
                    try {
                        const signed = await getPreSignedUrl(p.key);
                        if (signed) p.url = signed;
                    } catch (e) { console.error('Sign error', e); }
                }
                return p;
            }));

            // Also update the main profilePhoto if it matches one of the photos
            const profilePicObj = profile.photos.find(p => p.isProfile) || profile.photos[0];
            if (profilePicObj) {
                profile.profilePhoto = profilePicObj.url;
            }
        }

        res.status(200).json(profile);
    } catch (error) {
        logger.error('Get Member Profile Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
// Update a Member Profile (for multi-step forms)
exports.updateMemberProfile = async (req, res) => {
    try {
        const { profileId } = req.params;
        const updates = req.body;

        // Prevent updating critical fields
        const restrictedFields = [
            'password', 'role', 'created_by', 'username',
            '_id', 'created_at', 'updated_at', '__v',
            'photos', 'profilePhoto', 'is_phone_verified'
        ];

        // Filter updates
        const updatesToApply = {};
        Object.keys(updates).forEach((key) => {
            if (!restrictedFields.includes(key)) {
                updatesToApply[key] = updates[key];
            }
        });

        // Use findOneAndUpdate to avoid VersionError (optimistic locking) issues during concurrent photo uploads
        const profile = await User.findOneAndUpdate(
            { _id: profileId, created_by: req.user._id },
            { $set: updatesToApply },
            { new: true, runValidators: true }
        );

        if (!profile) {
            return res.status(404).json({ message: 'Profile not found or unauthorized' });
        }

        res.status(200).json({ success: true, message: 'Profile updated', profile });

    } catch (error) {
        logger.error('Update Member Profile Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// Upload Photo for Member
exports.uploadMemberPhoto = async (req, res) => {
    const startTotal = performance.now();
    try {
        const { profileId } = req.params;

        // Find profile owned by this franchise
        const profile = await User.findOne({ _id: profileId, created_by: req.user._id });
        if (!profile) {
            return res.status(404).json({ message: 'Profile not found or unauthorized' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No files uploaded' });
        }

        // Limit Check
        if (profile.photos.length + req.files.length > 10) {
            return res.status(400).json({ message: 'Maximum 10 photos allowed' });
        }

        logger.info(`Starting Franchise Upload for ${profile.username}: ${req.files.length} files`);

        const successUploads = [];
        const failedUploads = [];

        // Helper: Upload to S3
        const uploadLocal = async (buffer, key, contentType = 'image/webp') => {
            const uploadStart = performance.now();
            try {
                const command = new PutObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: key,
                    Body: buffer,
                    ContentType: contentType,
                });
                await s3Client.send(command);
                const duration = (performance.now() - uploadStart).toFixed(2);
                logger.debug(`S3 Upload Success (${duration}ms): ${key}`);
                return `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${key}`;
            } catch (err) {
                console.error('S3 Upload Error Helper:', err);
                throw err;
            }
        };

        const processFile = async (file, index) => {
            const fileStart = performance.now();
            try {
                const fileId = uuidv4();
                const folderPrefix = 'weedingzon/users';
                // Get extension
                const ext = path.extname(file.originalname) || '.jpg';
                const originalKey = `${folderPrefix}/${profile._id}/${fileId}_orig${ext}`;
                const blurredKey = `${folderPrefix}/${profile._id}/${fileId}_blur.webp`;

                logger.debug(`Processing File ${index + 1}/${req.files.length}: ${file.originalname} Size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);

                // 1. Upload Original RAW
                const originalUrl = await uploadLocal(file.buffer, originalKey, file.mimetype);

                // 2. Process Blurred (Thumbnail)
                const blurredBuffer = await sharp(file.buffer)
                    .rotate()
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

            } catch (err) {
                logger.error(`File Processing Failed: ${file.originalname}`, { error: err.message });
                return {
                    success: false,
                    filename: file.originalname,
                    error: err.message
                };
            }
        };

        // Sequential processing
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
            // Assign order
            successUploads.forEach((photo, idx) => {
                photo.order = profile.photos.length + idx;
            });

            profile.photos.push(...successUploads);

            // Set profile photo if missing
            if (!profile.photos.find(p => p.isProfile) && profile.photos.length > 0) {
                profile.photos[0].isProfile = true;
                profile.profilePhoto = profile.photos[0].url;
            }
            await profile.save();
            const totalDuration = (performance.now() - startTotal).toFixed(2);
            logger.info(`Upload Complete (${totalDuration}ms): ${successUploads.length} success, ${failedUploads.length} failed`);
        } else {
            logger.warn(`S3 Photos Upload Failed: ${profile.username} (All ${failedUploads.length} failed)`);
        }

        // Return current photo set (signed)
        const responsePhotos = await Promise.all(profile.photos.map(async (p) => {
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
        logger.error('Upload Member Photo Error', { error: error.message });
        res.status(500).json({ message: 'Server Error: ' + error.message });
    }
};

// Delete Member Photo
exports.deleteMemberPhoto = async (req, res) => {
    try {
        const { profileId, photoId } = req.params;
        const profile = await User.findOne({ _id: profileId, created_by: req.user._id });
        if (!profile) {
            return res.status(404).json({ message: 'Profile not found or unauthorized' });
        }

        const photoIndex = profile.photos.findIndex(p => p._id.toString() === photoId);
        if (photoIndex === -1) {
            return res.status(404).json({ message: 'Photo not found' });
        }

        const photo = profile.photos[photoIndex];

        // Delete from S3
        if (photo.key) {
            try {
                // Delete Original
                await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: photo.key }));

                // Delete Blurred (Infer key)
                if (photo.key.includes('_orig')) {
                    const blurKey = photo.key.replace(/_orig\.[^.]+$/, '_blur.webp');
                    try {
                        await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: blurKey }));
                    } catch (e) {
                        logger.warn('Failed to delete blur key', { key: blurKey, error: e.message });
                    }
                }
            } catch (err) {
                logger.error('S3 Delete Error', { error: err.message });
                // Continue to remove from DB even if S3 fails? Yes, to avoid ghost records.
            }
        }

        // Remove from array
        profile.photos.splice(photoIndex, 1);

        // Reset profile photo if needed
        if (photo.isProfile) {
            // Check if deleted photo string matches profilePhoto string, or just boolean flag?
            // The boolean flag is on the deleted object.
            // But we also need to clear profile.profilePhoto string if it matches.
            // user.controller logic:
            // if (photo.isProfile) { user.profilePhoto = null; if (len>0) ... }
            profile.profilePhoto = null;
            if (profile.photos.length > 0) {
                profile.photos[0].isProfile = true;
                profile.profilePhoto = profile.photos[0].url;
            }
        }

        await profile.save();

        // Generate Presigned URLs for response
        const responsePhotos = await Promise.all(profile.photos.map(async (p) => {
            const pObj = p.toObject();
            if (pObj.key) {
                try {
                    const signed = await getPreSignedUrl(pObj.key);
                    if (signed) pObj.url = signed;
                } catch (e) { }
            }
            return pObj;
        }));

        res.status(200).json({ success: true, message: 'Photo deleted', data: responsePhotos });

    } catch (error) {
        logger.error('Delete Member Photo Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// Set Member Profile Photo
exports.setMemberProfilePhoto = async (req, res) => {
    try {
        const { profileId, photoId } = req.params;
        const profile = await User.findOne({ _id: profileId, created_by: req.user._id });

        if (!profile) {
            return res.status(404).json({ message: 'Profile not found or unauthorized' });
        }

        // Unset previous profile photo
        profile.photos.forEach(p => {
            p.isProfile = false;
        });

        // Set new profile photo
        const targetPhoto = profile.photos.find(p => p._id.toString() === photoId);
        if (!targetPhoto) {
            return res.status(404).json({ message: 'Photo not found' });
        }

        targetPhoto.isProfile = true;
        profile.profilePhoto = targetPhoto.url; // This might need resigning conceptually but stored as generic URL/key usually?
        // Actually user.controller stores the CDN/S3 URL or key.
        // Since we use presigned URLs on read, the stored value matters less IF we iterate photos.
        // But let's stay consistent.

        await profile.save();

        // Return signed photos
        const responsePhotos = await Promise.all(profile.photos.map(async (p) => {
            const pObj = p.toObject();
            if (pObj.key) {
                try {
                    const signed = await getPreSignedUrl(pObj.key);
                    if (signed) pObj.url = signed;
                } catch (e) { }
            }
            return pObj;
        }));

        res.status(200).json({ success: true, message: 'Profile photo updated', data: responsePhotos });

    } catch (error) {
        logger.error('Set Member Profile Photo Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

const axios = require('axios'); // Add axios for image fetching

// Helper to fetch image buffer
async function fetchImageBuffer(url) {
    if (!url) return null;
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return response.data;
    } catch (error) {
        console.error('Failed to fetch image for PDF:', url, error.message);
        return null;
    }
}

// @desc    Generate PDF of Matches for a Profile
// @route   GET /api/franchise/custom-matches/:profileId/pdf
// @access  Private (Franchise)
exports.generateMatchPdf = async (req, res) => {
    try {
        const { profileId } = req.params;
        const franchiseUser = req.user;

        const profile = await User.findOne({ _id: profileId, created_by: franchiseUser._id });
        if (!profile) return res.status(404).json({ message: 'Profile not found' });

        // Logic to finding matches based on preferences (Same as before)
        const profileObj = profile.toObject({ flattenMaps: true });
        const prefs = profileObj.partner_preferences || {};

        const query = {
            status: 'active',
            _id: { $ne: profile._id, $nin: profile.blockedUsers || [] },
            is_profile_complete: true
        };

        if (Object.keys(prefs).length > 0) {
            // ... (Keep existing filter logic if possible, or simplifying for brevity in replacement? 
            // Better to keep exact logic. I'll include the filter logic from the previous file content)
            const minAge = prefs.minAge;
            const maxAge = prefs.maxAge;
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
            if (prefs.religion && prefs.religion !== 'Any') query.religion = prefs.religion;
            if (prefs.community) query.community = { $regex: prefs.community, $options: 'i' };
            if (prefs.location) {
                const locRegex = { $regex: prefs.location, $options: 'i' };
                query.$or = [{ city: locRegex }, { state: locRegex }, { country: locRegex }];
            }
            if (prefs.marital_status && prefs.marital_status !== 'Any') query.marital_status = prefs.marital_status;
            if (prefs.eating_habits && prefs.eating_habits !== 'Any') query.eating_habits = prefs.eating_habits;
            if (prefs.smoking_habits && prefs.smoking_habits !== 'Any') query.smoking_habits = prefs.smoking_habits;
            if (prefs.drinking_habits && prefs.drinking_habits !== 'Any') query.drinking_habits = prefs.drinking_habits;
            if (prefs.highest_education) query.highest_education = { $regex: prefs.highest_education, $options: 'i' };
            if (prefs.occupation) query.occupation = { $regex: prefs.occupation, $options: 'i' };
            if (prefs.annual_income && prefs.annual_income !== 'Any') query.annual_income = { $regex: prefs.annual_income, $options: 'i' };
        }

        // Fetch Matches (No Limit)
        const matches = await User.find(query).sort({ created_at: -1 }).lean();

        // Generate PDF
        const doc = new PDFDocument({ margin: 50 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=matches_${profile.first_name}.pdf`);

        doc.pipe(res);

        if (matches.length === 0) {
            doc.fontSize(16).text('No matches found matching the criteria.', { align: 'center' });
        } else {
            let isFirstPage = true;

            for (const match of matches) {
                if (!isFirstPage) {
                    doc.addPage();
                }
                isFirstPage = false;

                // --- Header ---
                doc.rect(0, 0, doc.page.width, 60).fill('#db2777'); // Pink Header
                doc.fillColor('white').fontSize(20).font('Helvetica-Bold')
                    .text('WeddingZon Profile Match', 20, 20, { align: 'center', width: doc.page.width - 40 });

                doc.fillColor('black'); // Reset color
                doc.moveDown(3);

                // --- Layout Variables ---
                const startY = 80;
                const leftColX = 50;
                const rightColX = 300;
                const photoWidth = 150;
                const photoHeight = 150;

                // --- Photo ---
                // Pre-sign the URL if needed, similar to getMemberProfile logic
                let photoUrl = match.profilePhoto;
                if (!photoUrl && match.photos && match.photos.length > 0) {
                    photoUrl = match.photos.find(p => p.isProfile)?.url || match.photos[0].url;
                }

                // If the URL is an S3 key (doesn't start with http), sign it
                // Logic: In DB we might store full Key or URL? Existing code suggests 'key' usage.
                if (photoUrl && !photoUrl.startsWith('http')) {
                    // Try to sign it if it looks like a key, or fetch full details
                    // Assuming simple URL for now or if keys are used, we need the `getPreSignedUrl` logic here too.
                    // But `match` is lean(). Let's try to get signed url.
                    try {
                        const signed = await getPreSignedUrl(photoUrl); // photoUrl as key?
                        if (signed) photoUrl = signed;
                    } catch (e) { }
                } else if (photoUrl && photoUrl.includes('s3.amazonaws')) {
                    // It is a URL but might be expired if not resigned?
                    // Usually we store public URLs or need resigning.
                    // Let's try to just fetch it.
                }

                if (photoUrl) {
                    const imgBuffer = await fetchImageBuffer(photoUrl);
                    if (imgBuffer) {
                        try {
                            doc.image(imgBuffer, leftColX, startY, {
                                fit: [photoWidth, photoHeight],
                                align: 'center',
                                valign: 'center'
                            });
                            // Draw border around photo
                            doc.rect(leftColX, startY, photoWidth, photoHeight).stroke();
                        } catch (e) {
                            // Fallback box
                            doc.rect(leftColX, startY, photoWidth, photoHeight).stroke();
                            doc.text('Photo Error', leftColX + 10, startY + 70);
                        }
                    } else {
                        // Placeholder Box
                        doc.rect(leftColX, startY, photoWidth, photoHeight).stroke();
                        doc.text('No Photo', leftColX + 40, startY + 70);
                    }
                } else {
                    doc.rect(leftColX, startY, photoWidth, photoHeight).stroke();
                    doc.text('No Photo', leftColX + 40, startY + 70);
                }

                // --- Basic Info Box (Right Side) ---
                doc.fontSize(18).font('Helvetica-Bold')
                    .text(`${match.first_name} ${match.last_name || ''}`, rightColX, startY);

                // Calculate Age
                let age = 'N/A';
                if (match.dob) {
                    age = Math.floor((Date.now() - new Date(match.dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
                }

                doc.fontSize(12).font('Helvetica').text(`Age: ${age} yrs`, rightColX, startY + 25);
                doc.text(`ID: ${match.username}`, rightColX, startY + 45);
                doc.text(`Role: ${match.role}`, rightColX, startY + 65);

                doc.moveDown();

                // --- Details Grid (Below Photo) ---
                let detailY = startY + photoHeight + 40;

                const drawField = (label, value, x, y) => {
                    doc.font('Helvetica-Bold').fontSize(10).text(label + ':', x, y);
                    doc.font('Helvetica').text(value || '-', x + 100, y);
                };

                const col1X = 50;
                const col2X = 300;
                const rowHeight = 20;

                // Section 1: Basic & Location
                doc.font('Helvetica-Bold').fontSize(14).fillColor('#db2777').text('Basic Details & Location', col1X, detailY);
                doc.fillColor('black');
                detailY += 25;

                drawField('Marital Status', match.marital_status, col1X, detailY);
                drawField('City', match.city, col2X, detailY);
                detailY += rowHeight;

                drawField('Height', match.height ? `${match.height}` : '-', col1X, detailY);
                drawField('State', match.state, col2X, detailY);
                detailY += rowHeight;

                drawField('Religion', match.religion, col1X, detailY);
                drawField('Country', match.country, col2X, detailY);
                detailY += rowHeight;

                drawField('Community', match.community, col1X, detailY);
                detailY += 30; // Spacer

                // Section 2: Education & Career
                doc.font('Helvetica-Bold').fontSize(14).fillColor('#db2777').text('Education & Career', col1X, detailY);
                doc.fillColor('black');
                detailY += 25;

                drawField('Education', match.highest_education, col1X, detailY);
                drawField('Occupation', match.occupation, col2X, detailY);
                detailY += rowHeight;

                drawField('Income', match.annual_income, col1X, detailY);
                drawField('Work Location', match.working_location, col2X, detailY);
                detailY += 30;

                // Section 3: Lifestyle & Family
                doc.font('Helvetica-Bold').fontSize(14).fillColor('#db2777').text('Lifestyle & Family', col1X, detailY);
                doc.fillColor('black');
                detailY += 25;

                drawField('Diet', match.eating_habits, col1X, detailY);
                drawField('Family Type', match.family_type, col2X, detailY);
                detailY += rowHeight;

                drawField('Smoking', match.smoking_habits, col1X, detailY);
                drawField('Family Status', match.family_status, col2X, detailY);
                detailY += rowHeight;

                drawField('Drinking', match.drinking_habits, col1X, detailY);

                // Footer
                const bottomY = doc.page.height - 50;
                doc.fontSize(10).fillColor('grey')
                    .text(`Generated by WeddingZon Franchise: ${franchiseUser.first_name} | ${new Date().toLocaleDateString()}`,
                        50, bottomY, { align: 'center', width: doc.page.width - 100 });
            }
        }

        doc.end();

    } catch (error) {
        logger.error('Generate PDF Error', { error: error.message });
        if (!res.headersSent) res.status(500).json({ message: 'Server Error' });
    }
};

const { sendEmail } = require('../services/email.service');
const twilio = require('twilio');

// @desc    Send Credentials (Reset Password & Notify)
// @route   POST /api/franchise/profiles/:profileId/send-credentials
// @access  Private (Franchise)
exports.sendMemberCredentials = async (req, res) => {
    try {
        const { profileId } = req.params;
        const profile = await User.findOne({ _id: profileId, created_by: req.user._id });

        if (!profile) {
            return res.status(404).json({ message: 'Profile not found or unauthorized' });
        }

        // Generate New Password (4 chars + 2 random digits for simplicity)
        const crypto = require('crypto');
        const newPassword = crypto.randomBytes(4).toString('hex') + Math.floor(10 + Math.random() * 90);

        // Update User
        profile.password = newPassword;
        await profile.save();

        const messageBody = `Welcome to WeddingZon! Your credentials have been updated.\nUsername: ${profile.username}\nPassword: ${newPassword}\nLogin at: ${process.env.CLIENT_URL || 'https://weddingzon.com'}/login`;

        // 1. Send Email
        if (profile.email) {
            await sendEmail({
                to: profile.email,
                subject: 'Your WeddingZon Credentials',
                text: messageBody,
                html: `<p>Welcome to <b>WeddingZon</b>!</p><p>Your credentials have been updated by your Franchise Partner.</p><p><b>Username:</b> ${profile.username}<br><b>Password:</b> ${newPassword}</p><p><a href="${process.env.CLIENT_URL || 'https://weddingzon.com'}/login">Login Here</a></p>`
            });
        }

        // 2. Send SMS (Twilio)
        if (profile.phone && process.env.TWILIO_ACCOUNT_SID) {
            try {
                const client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                await client.messages.create({
                    body: messageBody,
                    to: profile.phone.startsWith('+') ? profile.phone : `+91${profile.phone}`,
                    from: process.env.TWILIO_PHONE_NUMBER
                });
                logger.info(`SMS sent to ${profile.phone}`);
            } catch (smsError) {
                logger.error('SMS Send Failed', { error: smsError.message });
            }
        }

        res.status(200).json({ success: true, message: 'Credentials sent successfully' });

    } catch (error) {
        logger.error('Send Credentials Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};
