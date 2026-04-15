const Review = require('../models/Review');

// ─── GET /api/reviews/mine ────────────────────────────────────────────────────
// Artisans  → reviews they received (as artisanId)
// Customers → reviews they gave    (as customerId)
exports.getMyReviews = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const isArtisan = req.user.role === 'artisan';
    const query = isArtisan
      ? { artisanId: req.user._id }
      : { customerId: req.user._id };

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('customerId', 'name')
        .populate('artisanId', 'name')
        .populate('jobId', 'category')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Review.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: reviews.map((r) => ({
        id: r._id,
        jobCategory: r.jobId?.category || 'Job',
        customerName: r.customerId?.name || 'Customer',
        artisanName: r.artisanId?.name || 'Artisan',
        ratings: r.ratings,
        overallScore: r.overallScore,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total },
    });
  } catch (err) {
    console.error('getMyReviews error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load reviews.' });
  }
};
