const express = require('express');
const router = express.Router();
const { protect, optionalProtect, restrictTo } = require('../middleware/auth');
const {
  searchArtisans,
  getArtisanProfile,
  getArtisanReviews,
  rateJob,
  createComplaint,
} = require('../controllers/discoveryController');

// Artisan discovery — public routes, auth optional (enhances results if logged in)
router.get('/', optionalProtect, searchArtisans);
router.get('/:artisanId', optionalProtect, getArtisanProfile);
router.get('/:artisanId/reviews', optionalProtect, getArtisanReviews);

// Rate a job (customer only — route kept here for discovery context)
router.post('/jobs/:jobId/rate', protect, restrictTo('customer'), rateJob);

// Complaint submission (customer or artisan)
router.post('/complaints', protect, restrictTo('customer', 'artisan'), createComplaint);

module.exports = router;
