const User = require('../models/User');
const logger = require('../utils/logger');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { s3Client } = require('../config/s3');
const { getPreSignedUrl } = require('../utils/s3');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
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

        const newProfile = new User({
            first_name,
            last_name,
            email,
            phone,
            password: password || 'Welcome@123', // Default if missed, but frontend should enforce
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
                password: password || 'Welcome@123'
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

        // Find profile owned by this franchise
        const profile = await User.findOne({ _id: profileId, created_by: req.user._id });

        if (!profile) {
            return res.status(404).json({ message: 'Profile not found or unauthorized' });
        }

        // Prevent updating critical fields if needed
        delete updates.password;
        delete updates.role;
        delete updates.created_by;
        delete updates.username; // Usually username shouldn't change

        // Apply updates
        Object.keys(updates).forEach((key) => {
            profile[key] = updates[key];
        });

        // Check completeness (optional logic similar to user update)
        // profile.is_profile_complete = checkCompleteness(profile); 

        await profile.save();
        res.status(200).json({ success: true, message: 'Profile updated', profile });

    } catch (error) {
        logger.error('Update Member Profile Error', { error: error.message });
        res.status(500).json({ message: 'Server Error' });
    }
};

// Upload Photo for Member
exports.uploadMemberPhoto = async (req, res) => {
    try {
        const { profileId } = req.params;

        // Find profile owned by this franchise
        const profile = await User.findOne({ _id: profileId, created_by: req.user._id });
        if (!profile) {
            return res.status(404).json({ message: 'Profile not found or unauthorized' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No photos uploaded' });
        }

        // Helper: Upload to S3
        const uploadLocal = async (buffer, key, contentType = 'image/webp') => {
            try {
                const command = new PutObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: key,
                    Body: buffer,
                    ContentType: contentType,
                });
                await s3Client.send(command);
                return `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${key}`;
            } catch (err) {
                fs.appendFileSync('debug_upload.txt', `S3 Upload Error: ${err.message}\n${err.stack}\n`);
                throw err;
            }
        };

        const successUploads = [];
        const failedUploads = [];

        // Process each file
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            try {
                const fileId = uuidv4();
                const folderPrefix = 'weedingzon/users';
                const ext = path.extname(file.originalname) || '.jpg';
                const originalKey = `${folderPrefix}/${profile._id}/${fileId}_orig${ext}`;
                const blurredKey = `${folderPrefix}/${profile._id}/${fileId}_blur.webp`;

                // 1. Upload Original
                const originalUrl = await uploadLocal(file.buffer, originalKey, file.mimetype);

                // 2. Process Blurred
                const blurredBuffer = await sharp(file.buffer)
                    .rotate()
                    .resize({ width: 20 })
                    .blur(5)
                    .webp({ quality: 20 })
                    .toBuffer();

                await uploadLocal(blurredBuffer, blurredKey, 'image/webp');

                successUploads.push({
                    url: originalUrl,
                    key: originalKey,
                    isProfile: false,
                    order: profile.photos.length + i // Append order
                });

            } catch (err) {
                console.error(`Failed to upload ${file.originalname}`, err);
                failedUploads.push({ filename: file.originalname, error: err.message });
            }
        }

        if (successUploads.length > 0) {
            profile.photos.push(...successUploads);

            // Set profile photo if missing
            if (!profile.photos.find(p => p.isProfile)) {
                if (profile.photos.length > 0) {
                    profile.photos[0].isProfile = true;
                    profile.profilePhoto = profile.photos[0].url;
                }
            }
            await profile.save();
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


        res.status(200).json({ success: true, data: responsePhotos });

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
            return res.status(404).json({ message: 'Profile not found' });
        }

        profile.photos = profile.photos.filter(p => p._id.toString() !== photoId);

        // If profile photo was deleted, set new one
        if (profile.profilePhoto && !profile.photos.find(p => p.url === profile.profilePhoto)) {
            profile.profilePhoto = profile.photos.length > 0 ? profile.photos[0].url : null;
            if (profile.photos.length > 0) profile.photos[0].isProfile = true;
        }

        await profile.save();
        res.status(200).json({ success: true, data: profile.photos });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Generate PDF of Matches for a Profile
// @route   GET /api/franchise/custom-matches/:profileId/pdf
// @access  Private (Franchise)
exports.generateMatchPdf = async (req, res) => {
    try {
        const { profileId } = req.params;
        const franchiseUser = req.user;

        const profile = await User.findOne({ _id: profileId, created_by: franchiseUser._id });
        if (!profile) return res.status(404).json({ message: 'Profile not found' });

        // Logic to finding matches based on preferences (Aligned with Feed Logic)
        const profileObj = profile.toObject({ flattenMaps: true });
        const prefs = profileObj.partner_preferences || {};

        console.log(`[PDF Gen] Preferences for ${profile.username}:`, prefs);

        const query = {
            status: 'active',
            _id: { $ne: profile._id, $nin: profile.blockedUsers || [] },
            is_profile_complete: true
        };

        if (Object.keys(prefs).length > 0) {
            // 1. Age Filter
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

            // 2. Religion
            if (prefs.religion && prefs.religion !== 'Any') query.religion = prefs.religion;

            // 3. Community
            if (prefs.community) query.community = { $regex: prefs.community, $options: 'i' };

            // 4. Location
            if (prefs.location) {
                const locRegex = { $regex: prefs.location, $options: 'i' };
                query.$or = [
                    { city: locRegex },
                    { state: locRegex },
                    { country: locRegex }
                ];
            }

            // 5. Marital Status
            if (prefs.marital_status && prefs.marital_status !== 'Any') query.marital_status = prefs.marital_status;

            // 6. Diet
            if (prefs.eating_habits && prefs.eating_habits !== 'Any') query.eating_habits = prefs.eating_habits;

            // 7. Smoking
            if (prefs.smoking_habits && prefs.smoking_habits !== 'Any') query.smoking_habits = prefs.smoking_habits;

            // 8. Drinking
            if (prefs.drinking_habits && prefs.drinking_habits !== 'Any') query.drinking_habits = prefs.drinking_habits;

            // 9. Education
            if (prefs.highest_education) query.highest_education = { $regex: prefs.highest_education, $options: 'i' };

            // 10. Occupation
            if (prefs.occupation) query.occupation = { $regex: prefs.occupation, $options: 'i' };

            // 11. Annual Income
            if (prefs.annual_income && prefs.annual_income !== 'Any') query.annual_income = { $regex: prefs.annual_income, $options: 'i' };
        }

        console.log('[PDF Gen] Final Query:', JSON.stringify(query, null, 2));

        // Fetch Matches (No Limit for PDF as requested)
        const matches = await User.find(query).lean();
        console.log(`[PDF Gen] Found ${matches.length} matches`);

        // Generate PDF
        const doc = new PDFDocument();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=matches_${profile.first_name}.pdf`);

        doc.pipe(res);

        // PDF Content
        doc.fontSize(20).text(`Matches for ${profile.first_name} ${profile.last_name}`, { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Generated by WeddingZon Franchise: ${franchiseUser.first_name}`, { align: 'center' });
        doc.moveDown(2);

        if (matches.length === 0) {
            doc.text('No matches found matching the criteria.', { align: 'center' });
        } else {
            for (const match of matches) {
                // Determine Age
                let age = 'N/A';
                if (match.dob) {
                    age = Math.floor((Date.now() - new Date(match.dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
                }

                doc.fontSize(14).font('Helvetica-Bold').text(`${match.first_name} ${match.last_name || ''} (${age} yrs)`);
                doc.fontSize(10).font('Helvetica').text(`ID: ${match.username}`);
                doc.text(`Location: ${match.city || '-'}, ${match.state || '-'}`);
                doc.text(`Occupation: ${match.occupation || '-'}`);
                doc.text(`Religion: ${match.religion || '-'} | Community: ${match.community || '-'}`);

                // Add basic image if possible? (Complex due to async S3 fetching/signing and streaming). 
                // For now, let's ship text details.
                // doc.image(...) requires a buffer or path.

                doc.moveDown();
                doc.text('---------------------------------------------------');
                doc.moveDown();
            }
        }

        doc.end();

    } catch (error) {
        logger.error('Generate PDF Error', { error: error.message });
        if (!res.headersSent) res.status(500).json({ message: 'Server Error' });
    }
};
