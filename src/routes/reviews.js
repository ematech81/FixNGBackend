const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getMyReviews } = require('../controllers/reviewController');

// GET /api/reviews/mine — logged-in user's reviews (given or received)
router.get('/mine', protect, getMyReviews);

module.exports = router;
