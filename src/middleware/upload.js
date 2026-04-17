const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

// ─── Image Storage (profile photo, verification ID) ───────────────────────────
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'fixng/artisans',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1000, crop: 'limit', quality: 'auto' }],
    public_id: `${req.user._id}_${file.fieldname}_${Date.now()}`,
  }),
});

// ─── ID Document Storage ───────────────────────────────────────────────────────
const idStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'fixng/verification-ids',
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'],
    transformation: [{ width: 1500, crop: 'limit', quality: 'auto' }],
    public_id: `${req.user._id}_id_${Date.now()}`,
  }),
});

// ─── Video Storage (skill video) ──────────────────────────────────────────────
const videoStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'fixng/skill-videos',
    resource_type: 'video',
    allowed_formats: ['mp4', 'mov', 'avi', 'webm', '3gp'], // 3gp common on Nigerian Android phones
    public_id: `${req.user._id}_video_${Date.now()}`,
  }),
});

// ─── File filters ──────────────────────────────────────────────────────────────
const imageFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) return cb(null, true);
  cb(new Error('Only image files are allowed.'), false);
};

const idFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
    return cb(null, true);
  }
  cb(new Error('Only images or PDF are allowed for ID.'), false);
};

const videoFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('video/')) return cb(null, true);
  cb(new Error('Only video files are allowed.'), false);
};

// ─── Multer instances ──────────────────────────────────────────────────────────
exports.uploadProfilePhoto = multer({
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
}).single('profilePhoto');

exports.uploadVerificationId = multer({
  storage: idStorage,
  fileFilter: idFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
}).single('verificationId');

exports.uploadSkillVideo = multer({
  storage: videoStorage,
  fileFilter: videoFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB — videos on slow networks need generous limit
}).single('skillVideo');

// ─── Job Images Storage (multiple, up to 5) ───────────────────────────────────
const jobImageStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, _file) => ({
    folder: 'fixng/job-images',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }],
    public_id: `job_${req.user._id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  }),
});

exports.uploadJobImages = multer({
  storage: jobImageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB per image
}).array('images', 5); // max 5 images per job

// ─── Chat Image Storage ───────────────────────────────────────────────────────
const chatImageStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, _file) => ({
    folder: 'fixng/chat-images',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1000, crop: 'limit', quality: 'auto' }],
    public_id: `chat_${req.user._id}_${Date.now()}`,
  }),
});

exports.uploadChatImage = multer({
  storage: chatImageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
}).single('image');

// ─── Chat Audio (Voice Note) Storage ─────────────────────────────────────────
const chatAudioStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, _file) => ({
    folder: 'fixng/chat-audio',
    resource_type: 'video', // Cloudinary uses 'video' resource_type for audio files
    allowed_formats: ['mp3', 'm4a', 'aac', 'ogg', 'wav', 'mp4', 'caf'],
    public_id: `voice_${req.user._id}_${Date.now()}`,
  }),
});

const audioFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('audio/') || file.mimetype === 'video/mp4') {
    return cb(null, true);
  }
  cb(new Error('Only audio files are allowed.'), false);
};

exports.uploadChatAudio = multer({
  storage: chatAudioStorage,
  fileFilter: audioFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — 3-min audio is typically < 5MB
}).single('audio');

// ─── Combined Job Media Storage (images + optional voice description) ─────────
// Branches folder/resource_type based on fieldname so both can live in one upload
const jobMediaStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    if (file.fieldname === 'voiceDescription') {
      return {
        folder: 'fixng/job-voice',
        resource_type: 'video', // Cloudinary uses 'video' for audio
        allowed_formats: ['mp3', 'm4a', 'aac', 'ogg', 'wav', 'mp4', 'caf'],
        public_id: `jobvoice_${req.user._id}_${Date.now()}`,
      };
    }
    return {
      folder: 'fixng/job-images',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }],
      public_id: `job_${req.user._id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    };
  },
});

const jobMediaFilter = (req, file, cb) => {
  if (file.fieldname === 'voiceDescription') return audioFilter(req, file, cb);
  return imageFilter(req, file, cb);
};

// Replaces the old uploadJobImages — handles images[] + optional voiceDescription
exports.uploadJobMedia = multer({
  storage: jobMediaStorage,
  fileFilter: jobMediaFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
}).fields([
  { name: 'images', maxCount: 5 },
  { name: 'voiceDescription', maxCount: 1 },
]);

// ─── Multer error handler middleware ──────────────────────────────────────────
exports.handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File is too large.' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
};
