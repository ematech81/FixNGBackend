const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();

// Send OTP — keyed per phone number: 10 sends per 10 minutes
const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.phone || ipKeyGenerator(req),
  message: { success: false, message: 'Too many code requests. Please wait 10 minutes and try again.' },
});

// Verify OTP — keyed per phone: 15 attempts per 15 minutes (separate from send quota)
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.phone || ipKeyGenerator(req),
  message: { success: false, message: 'Too many verification attempts. Please wait 15 minutes.' },
});

const checkDeviceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
});

const {
  register,
  login,
  getMe,
  checkDevice,
  sendOTPHandler,
  verifyRegister,
  verifyLoginOTP,
  becomeArtisan,
  cancelArtisanRegistration,
  updateUserProfile,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// ── Phone OTP flow ─────────────────────────────────────────────────────────────
// Step 0: check if device is trusted — may skip OTP entirely
router.post('/check-device', checkDeviceLimiter, checkDevice);

// Step 1: send OTP (for both register and login)
router.post('/otp/send', otpSendLimiter, sendOTPHandler);

// Step 2a: verify OTP + create new account
router.post('/otp/verify-register', otpVerifyLimiter, verifyRegister);

// Step 2b: verify OTP + log in existing account
router.post('/otp/verify-login', otpVerifyLimiter, verifyLoginOTP);

// ── Email / password flow (legacy / admin) ─────────────────────────────────────
router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required.'),
    body('email').isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('phone')
      .matches(/^(\+234|0)[7-9][0-1]\d{8}$/)
      .withMessage('Enter a valid Nigerian phone number.'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
    body('role').isIn(['customer', 'artisan']).withMessage('Role must be customer or artisan.'),
  ],
  register
);

router.post('/login', loginLimiter, login);

// ── Account upgrades ──────────────────────────────────────────────────────────
// Customer → Artisan (creates ArtisanProfile, upgrades role)
router.post('/become-artisan', protect, becomeArtisan);
// Artisan → Customer (deletes ArtisanProfile, reverts role)
router.post('/cancel-artisan-registration', protect, cancelArtisanRegistration);

// ── Shared ────────────────────────────────────────────────────────────────────
router.get('/me', protect, getMe);
router.put('/profile', protect, updateUserProfile);

// ── Push notification token registration ──────────────────────────────────────
router.post('/push-token', protect, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token is required.' });
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user._id, { expoPushToken: token });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('push-token error:', err);
    res.status(500).json({ success: false, message: 'Failed to save push token.' });
  }
});

module.exports = router;
