const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  uploadProfilePhoto: uploadPhotoMiddleware,
  uploadVerificationId: uploadIdMiddleware,
  uploadSkillVideo: uploadVideoMiddleware,
  handleUploadError,
} = require('../middleware/upload');
const {
  getOnboardingStatus,
  uploadProfilePhoto,
  saveProfilePhotoUrl,
  updateSkills,
  updateLocation,
  uploadVerificationId,
  uploadSkillVideo,
  saveSkillVideoUrl,
  skipVerificationId,
  skipSkillVideo,
  getSkillsList,
} = require('../controllers/artisanController');
const { updateBio } = require('../controllers/discoveryController');

// All artisan routes require authentication and artisan role
router.use(protect, restrictTo('artisan'));

// Onboarding
router.get('/onboarding/status', getOnboardingStatus);

router.post(
  '/onboarding/profile-photo',
  uploadPhotoMiddleware,
  handleUploadError,
  uploadProfilePhoto
);

router.post('/onboarding/skills', updateSkills);

router.post('/onboarding/location', updateLocation);

router.post(
  '/onboarding/verification-id',
  uploadIdMiddleware,
  handleUploadError,
  uploadVerificationId
);

router.post(
  '/onboarding/skill-video',
  (req, _res, next) => { req.setTimeout(300000); next(); }, // 5-min timeout for large videos
  uploadVideoMiddleware,
  handleUploadError,
  uploadSkillVideo
);

// Direct Cloudinary upload — frontend uploads to Cloudinary, sends URL here to save
router.post('/onboarding/profile-photo-url', saveProfilePhotoUrl);
router.post('/onboarding/skill-video-url',   saveSkillVideoUrl);

// Skip optional steps
router.post('/onboarding/skip-verification-id', skipVerificationId);
router.post('/onboarding/skip-skill-video', skipSkillVideo);

// Bio update
router.post('/bio', updateBio);

// Utility
router.get('/skills-list', getSkillsList);

module.exports = router;
