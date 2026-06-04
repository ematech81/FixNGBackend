const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { protect, restrictTo, requireVerified } = require('../middleware/auth');
const { uploadJobMedia, handleUploadError } = require('../middleware/upload');

// 10 job posts per user per hour (keyed by user ID — protect middleware always runs first)
const createJobLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user._id.toString(),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many job posts. Please wait before posting again.' },
});
const {
  createJob,
  getAvailableJobs,
  acceptJob,
  declineJob,
  markArrived,
  markCompleted,
  raiseDispute,
  cancelJob,
  getJob,
  getMyJobs,
} = require('../controllers/jobController');
const { rateJob } = require('../controllers/discoveryController');

// ── Job creation — customers and verified artisans can both post jobs ─────────
router.post(
  '/',
  protect,
  restrictTo('customer', 'artisan'),
  createJobLimiter,
  uploadJobMedia,
  handleUploadError,
  createJob
);

// ── Shared routes (customer + artisan) ────────────────────────────────────────
router.get('/my', protect, restrictTo('customer', 'artisan'), getMyJobs);
router.get('/:jobId', protect, getJob);
router.post('/:jobId/dispute', protect, restrictTo('customer', 'artisan'), raiseDispute);
router.post('/:jobId/cancel', protect, restrictTo('customer', 'artisan'), cancelJob);
router.post('/:jobId/rate', protect, restrictTo('customer'), rateJob);

// ── Artisan-only routes (must be verified) ────────────────────────────────────
router.get('/artisan/available', protect, restrictTo('artisan'), requireVerified, getAvailableJobs);
router.post('/:jobId/accept', protect, restrictTo('artisan'), requireVerified, acceptJob);
router.post('/:jobId/decline', protect, restrictTo('artisan'), requireVerified, declineJob);
router.post('/:jobId/arrived', protect, restrictTo('artisan'), requireVerified, markArrived);
router.post('/:jobId/complete', protect, restrictTo('artisan'), requireVerified, markCompleted);

module.exports = router;
