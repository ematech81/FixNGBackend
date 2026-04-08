const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const {
  register,
  login,
  getMe,
  checkDevice,
  sendOTPHandler,
  verifyRegister,
  verifyLoginOTP,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// ── Phone OTP flow ─────────────────────────────────────────────────────────────
// Step 0: check if device is trusted — may skip OTP entirely
router.post('/check-device', checkDevice);

// Step 1: send OTP (for both register and login)
router.post('/otp/send', sendOTPHandler);

// Step 2a: verify OTP + create new account
router.post('/otp/verify-register', verifyRegister);

// Step 2b: verify OTP + log in existing account
router.post('/otp/verify-login', verifyLoginOTP);

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

// ── Shared ────────────────────────────────────────────────────────────────────
router.get('/me', protect, getMe);

module.exports = router;
