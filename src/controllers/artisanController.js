const ArtisanProfile = require('../models/ArtisanProfile');
const cloudinary = require('../config/cloudinary');
const ARTISAN_SKILLS = require('../constants/skills');

// ─── Helper: delete old cloudinary asset if replacing ─────────────────────────
const deleteCloudinaryAsset = async (publicId, resourceType = 'image') => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    console.warn('Could not delete old cloudinary asset:', publicId, err.message);
  }
};

// ─── GET /api/artisan/onboarding/status ───────────────────────────────────────
exports.getOnboardingStatus = async (req, res) => {
  try {
    let profile = await ArtisanProfile.findOne({ userId: req.user._id });

    if (!profile) {
      // Profile missing — create a blank one so the artisan can proceed through onboarding.
      // This recovers accounts where registration partially succeeded (User saved, profile didn't).
      profile = await ArtisanProfile.create({ userId: req.user._id });
    }

    res.status(200).json({
      success: true,
      data: {
        verificationStatus: profile.verificationStatus,
        onboardingComplete: profile.onboardingComplete,
        completedSteps: profile.completedSteps,
        skippedSteps: profile.skippedSteps,
        rejectionReason: profile.rejectionReason,
        // Return partial data so frontend can show what's already uploaded
        profilePhoto: profile.profilePhoto?.url || null,
        skills: profile.skills,
        location: {
          address: profile.location?.address || null,
          state: profile.location?.state || null,
          lga: profile.location?.lga || null,
          coordinates: profile.location?.coordinates || null,
        },
        verificationId: {
          uploaded: !!profile.verificationId?.url,
          idType: profile.verificationId?.idType || null,
        },
        skillVideo: {
          uploaded: !!profile.skillVideo?.url,
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch onboarding status.' });
  }
};

// ─── POST /api/artisan/onboarding/profile-photo ───────────────────────────────
exports.uploadProfilePhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No photo uploaded.' });
    }

    const profile = await ArtisanProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Artisan profile not found.' });
    }

    // Delete old photo from cloudinary if replacing
    if (profile.profilePhoto?.publicId) {
      await deleteCloudinaryAsset(profile.profilePhoto.publicId, 'image');
    }

    profile.profilePhoto = {
      url: req.file.path,
      publicId: req.file.filename,
    };
    profile.completedSteps.profilePhoto = true;

    await profile.save();

    res.status(200).json({
      success: true,
      message: 'Profile photo uploaded.',
      data: {
        profilePhotoUrl: profile.profilePhoto.url,
        completedSteps: profile.completedSteps,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Photo upload failed. Please try again.' });
  }
};

// ─── POST /api/artisan/onboarding/skills ──────────────────────────────────────
exports.updateSkills = async (req, res) => {
  try {
    const { skills } = req.body;

    if (!Array.isArray(skills) || skills.length === 0) {
      return res.status(400).json({ success: false, message: 'Select at least one skill.' });
    }

    // Validate against the known skills list
    const invalidSkills = skills.filter((s) => !ARTISAN_SKILLS.includes(s));
    if (invalidSkills.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid skills: ${invalidSkills.join(', ')}`,
      });
    }

    if (skills.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'You can select a maximum of 5 skills.',
      });
    }

    const profile = await ArtisanProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Artisan profile not found.' });
    }

    profile.skills = skills;
    profile.completedSteps.skills = true;

    await profile.save();

    res.status(200).json({
      success: true,
      message: 'Skills saved.',
      data: {
        skills: profile.skills,
        completedSteps: profile.completedSteps,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to save skills.' });
  }
};

// ─── POST /api/artisan/onboarding/location ────────────────────────────────────
exports.updateLocation = async (req, res) => {
  try {
    const { latitude, longitude, address, state, lga } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'GPS coordinates are required. Enable location or enter manually.',
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, message: 'Invalid coordinates.' });
    }

    if (!address || !state) {
      return res.status(400).json({
        success: false,
        message: 'Address and state are required.',
      });
    }

    const profile = await ArtisanProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Artisan profile not found.' });
    }

    profile.location = {
      type: 'Point',
      coordinates: [lng, lat], // GeoJSON: [longitude, latitude]
      address,
      state,
      lga: lga || null,
    };
    profile.completedSteps.location = true;

    await profile.save();

    res.status(200).json({
      success: true,
      message: 'Location saved.',
      data: {
        location: {
          address: profile.location.address,
          state: profile.location.state,
          lga: profile.location.lga,
        },
        completedSteps: profile.completedSteps,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to save location.' });
  }
};

// ─── POST /api/artisan/onboarding/verification-id ─────────────────────────────
exports.uploadVerificationId = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No ID document uploaded.' });
    }

    const { idType } = req.body;
    const validIdTypes = ['NIN', 'Voters Card', "Driver's License", 'International Passport', 'BVN'];

    if (!idType || !validIdTypes.includes(idType)) {
      return res.status(400).json({
        success: false,
        message: `ID type is required. Valid options: ${validIdTypes.join(', ')}`,
      });
    }

    const profile = await ArtisanProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Artisan profile not found.' });
    }

    // Delete old ID document from cloudinary if replacing
    if (profile.verificationId?.publicId) {
      await deleteCloudinaryAsset(profile.verificationId.publicId, 'image');
    }

    profile.verificationId = {
      url: req.file.path,
      publicId: req.file.filename,
      idType,
      uploadedAt: new Date(),
    };
    profile.completedSteps.verificationId = true;
    // Clear the skip flag — user is now uploading properly
    profile.skippedSteps.verificationId = false;

    // If the profile was previously rejected, reset to pending review
    if (profile.verificationStatus === 'rejected') {
      profile.verificationStatus = 'incomplete';
      profile.rejectionReason = null;
    }

    await profile.save();

    res.status(200).json({
      success: true,
      message: 'Verification ID uploaded.',
      data: {
        idType: profile.verificationId.idType,
        uploadedAt: profile.verificationId.uploadedAt,
        completedSteps: profile.completedSteps,
        verificationStatus: profile.verificationStatus,
      },
    });
  } catch (err) { 
    console.error(err);
    res.status(500).json({ success: false, message: 'ID upload failed. Please try again.' });
  }
};

// ─── POST /api/artisan/onboarding/skill-video ─────────────────────────────────
exports.uploadSkillVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No video uploaded.' });
    }

    const profile = await ArtisanProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Artisan profile not found.' });
    }

    // Delete old video from cloudinary if replacing
    if (profile.skillVideo?.publicId) {
      await deleteCloudinaryAsset(profile.skillVideo.publicId, 'video');
    }

    profile.skillVideo = {
      url: req.file.path,
      publicId: req.file.filename,
      uploadedAt: new Date(),
    };
    profile.completedSteps.skillVideo = true;
    // Clear the skip flag — user is now uploading properly
    profile.skippedSteps.skillVideo = false;

    await profile.save();

    res.status(200).json({
      success: true,
      message: 'Skill video uploaded.',
      data: {
        skillVideoUploaded: true,
        completedSteps: profile.completedSteps,
        onboardingComplete: profile.onboardingComplete,
        verificationStatus: profile.verificationStatus,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Video upload failed. Please try again.' });
  }
};

// ─── POST /api/artisan/onboarding/skip-verification-id ───────────────────────
// User chose to skip ID upload. Marks step as done (so routing advances) but
// sets skippedSteps.verificationId = true so they stay ineligible for verification.
exports.skipVerificationId = async (req, res) => {
  try {
    const profile = await ArtisanProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Artisan profile not found.' });
    }

    profile.completedSteps.verificationId = true;
    profile.skippedSteps.verificationId = true;

    await profile.save();

    res.status(200).json({
      success: true,
      message: 'Verification ID step skipped.',
      data: {
        completedSteps: profile.completedSteps,
        skippedSteps: profile.skippedSteps,
        onboardingComplete: profile.onboardingComplete,
        verificationStatus: profile.verificationStatus,
      },
    });
  } catch (err) {
    console.error('skipVerificationId error:', err);
    res.status(500).json({ success: false, message: 'Could not skip step. Please try again.' });
  }
};

// ─── POST /api/artisan/onboarding/skip-skill-video ────────────────────────────
// User chose to skip skill video. Same pattern as above.
exports.skipSkillVideo = async (req, res) => {
  try {
    const profile = await ArtisanProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Artisan profile not found.' });
    }

    profile.completedSteps.skillVideo = true;
    profile.skippedSteps.skillVideo = true;

    await profile.save();

    res.status(200).json({
      success: true,
      message: 'Skill video step skipped.',
      data: {
        completedSteps: profile.completedSteps,
        skippedSteps: profile.skippedSteps,
        onboardingComplete: profile.onboardingComplete,
        verificationStatus: profile.verificationStatus,
      },
    });
  } catch (err) {
    console.error('skipSkillVideo error:', err);
    res.status(500).json({ success: false, message: 'Could not skip step. Please try again.' });
  }
};

// ─── GET /api/artisan/skills-list ─────────────────────────────────────────────
exports.getSkillsList = (req, res) => {
  res.status(200).json({ success: true, data: ARTISAN_SKILLS });
};
