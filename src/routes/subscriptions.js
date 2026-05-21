const express    = require('express');
const router     = express.Router();
const rateLimit  = require('express-rate-limit');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl       = require('../controllers/subscriptionController');

const initLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many payment attempts. Please try again in an hour.' },
});

const refundLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many refund requests. Please try again in an hour.' },
});

// ── Kora Pay ──────────────────────────────────────────────────────────────────
router.get('/me',                protect, restrictTo('artisan'), ctrl.getMySubscription);
router.post('/initialize',       protect, restrictTo('artisan'), initLimiter, ctrl.initializeSubscription);
router.get('/verify/:reference', protect, restrictTo('artisan'), ctrl.verifySubscription);
router.post('/cancel',           protect, restrictTo('artisan'), ctrl.cancelSubscription);
router.post('/refund',           protect, refundLimiter, ctrl.requestRefund);

// ── Flutterwave legacy ────────────────────────────────────────────────────────
// initiate → 410 Gone; webhook stays alive for 30-day catch window
router.post('/initiate', ctrl.initiateSubscription);
router.post('/webhook',  ctrl.flutterwaveWebhook);

module.exports = router;
