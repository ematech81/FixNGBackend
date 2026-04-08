const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  searchArtisans,
  getArtisanProfile,
  getArtisanReviews,
  rateJob,
  createComplaint,
} = require('../controllers/discoveryController');

// Public artisan discovery — any authenticated user can search
router.get('/', protect, searchArtisans);
router.get('/:artisanId', protect, getArtisanProfile);
router.get('/:artisanId/reviews', protect, getArtisanReviews);

// Rate a job (customer only — route kept here for discovery context)
router.post('/jobs/:jobId/rate', protect, restrictTo('customer'), rateJob);

// Complaint submission (customer or artisan)
router.post('/complaints', protect, restrictTo('customer', 'artisan'), createComplaint);

module.exports = router;
