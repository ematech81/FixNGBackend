const express = require('express');
const router = express.Router();
const { protect, restrictTo, requireVerified } = require('../middleware/auth');
const { uploadJobImages, handleUploadError } = require('../middleware/upload');
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
  uploadJobImages,
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
