const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
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
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// ── Phone OTP flow ─────────────────────────────────────────────────────────────
// Step 0: check if device is trusted — may skip OTP entirely
router.post('/check-device', checkDevice);

// Step 1: send OTP (for both register and login)
router.post('/otp/send', otpLimiter, sendOTPHandler);

// Step 2a: verify OTP + create new account
router.post('/otp/verify-register', otpLimiter, verifyRegister);

// Step 2b: verify OTP + log in existing account
router.post('/otp/verify-login', otpLimiter, verifyLoginOTP);

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

router.post('/login', login);

// ── Account upgrades ──────────────────────────────────────────────────────────
// Customer → Artisan (creates ArtisanProfile, upgrades role)
router.post('/become-artisan', protect, becomeArtisan);
// Artisan → Customer (deletes ArtisanProfile, reverts role)
router.post('/cancel-artisan-registration', protect, cancelArtisanRegistration);

// ── Shared ────────────────────────────────────────────────────────────────────
router.get('/me', protect, getMe);

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
