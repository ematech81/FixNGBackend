const ArtisanProfile = require('../models/ArtisanProfile');

// Haversine formula — returns distance in km between two coordinates
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const Review = require('../models/Review');
const Job = require('../models/Job');
const User = require('../models/User');
const { notify } = require('./notificationController');
const { isDefaultCoords } = require('../utils/nigeriaGeo');
const { searchableQuery } = require('../utils/artisanVisibility');
const { findArtisansPage } = require('../services/artisanSearch');

// ─── GET /api/artisans — List verified artisans, nearest first ───────────────
// Query params: latitude + longitude (turns on nearest-first), category, state, q (name/skill text),
//   minRating, isPro, page, limit, and OPTIONALLY maxDistance (km) as a hard radius.
// Returns EVERY visible artisan across pages (see services/artisanSearch.js for the guarantees).
exports.searchArtisans = async (req, res) => {
  try {
    const { category } = req.query;
    const minRating = parseFloat(req.query.minRating) || 0;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip  = (page - 1) * limit;
    const lat = parseFloat(req.query.latitude);
    const lng = parseFloat(req.query.longitude);
    // A radius is applied ONLY when the client asks for one. (It used to default to 20 km, which hid
    // artisans in other cities and made the marketplace look empty.)
    const radiusAsked = parseFloat(req.query.maxDistance);
    const maxDistanceKm = radiusAsked > 0 ? Math.min(200, Math.max(1, radiusAsked)) : null;
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // The shared definition of "visible" — also used by the admin dashboard count
    const query = await searchableQuery();

    if (category) query.skills = category;
    if (minRating > 0) query['stats.averageRating'] = { $gte: minRating };
    if (req.query.isPro === 'true') query.isPro = true;

    // State filter (exact, case-insensitive) — done here so paging stays correct with it
    const stateFilter = (req.query.state || '').toString().trim();
    if (stateFilter) query['location.state'] = new RegExp(`^${escapeRegex(stateFilter)}$`, 'i');

    // Free-text search over skills and the artisan's name — also here, for the same reason
    const text = (req.query.q || '').toString().trim().slice(0, 60);
    if (text) {
      const rx = new RegExp(escapeRegex(text), 'i');
      const named = await User.find({ role: 'artisan', name: rx }).select('_id').limit(500).lean();
      query.$and = [{ $or: [{ skills: rx }, { userId: { $in: named.map((u) => u._id) } }] }];
    }

    const { profiles, total } = await findArtisansPage({ query, lat, lng, maxDistanceKm, page, limit });

    const artisans = profiles
      .filter((p) => p.userId?._id)   // defensive: the query already excludes deleted accounts
      .map((p) => {
        let distanceKm = null;
        // Only report a distance when the artisan's point is trustworthy: not the old
        // "centre of Nigeria" placeholder and not just their state's main city.
        const coordsReliable = !isDefaultCoords(p.location?.coordinates) &&
          p.location?.geoSource !== 'state' && p.location?.geoSource !== 'default';
        if (Number.isFinite(lat) && Number.isFinite(lng) && coordsReliable && p.location?.coordinates?.length === 2) {
          const [artisanLng, artisanLat] = p.location.coordinates;
          distanceKm = Math.round(haversineKm(lat, lng, artisanLat, artisanLng) * 10) / 10;
        }
        return {
          id: p.userId._id,
          name: p.userId.name,
          profilePhoto: p.profilePhoto?.url || null,
          skills: p.skills,
          bio: p.bio,
          address: p.location?.address || null,
          state: p.location?.state || null,
          lga: p.location?.lga || null,
          badgeLevel: p.badgeLevel,
          isPro: p.isPro || false,
          distanceKm,
          stats: {
            completedJobs: p.stats.completedJobs,
            averageRating: p.stats.averageRating,
            totalRatings: p.stats.totalRatings,
            avgResponseTimeMinutes: p.stats.avgResponseTimeMinutes,
          },
        };
      });

    res.status(200).json({
      success: true,
      count: artisans.length,
      data: artisans,
      // For "Load More": `total` = everything matching the filters, `hasMore` = another page exists
      pagination: { page, limit, total, hasMore: skip + limit < total },
    });
  } catch (err) {
    console.error('searchArtisans error:', err);
    res.status(500).json({ success: false, message: 'Search failed. Please try again.' });
  }
};

// ─── GET /api/artisans/:artisanId — Public artisan profile ────────────────────
exports.getArtisanProfile = async (req, res) => {
  try {
    const { artisanId } = req.params;

    const profile = await ArtisanProfile.findOne({ userId: artisanId })
      .populate('userId', 'name createdAt artisanCode')
      .lean();

    if (!profile || profile.verificationStatus !== 'verified') {
      return res.status(404).json({ success: false, message: 'Artisan profile not found.' });
    }

    if (profile.isBanned || profile.isSuspended) {
      return res.status(404).json({ success: false, message: 'Artisan profile not found.' });
    }

    // Guard: populate returns null when the user document has been deleted
    if (!profile.userId) {
      console.error(`getArtisanProfile: orphaned profile for artisanId=${artisanId} (user deleted)`);
      return res.status(404).json({ success: false, message: 'Artisan profile not found.' });
    }

    res.status(200).json({
      success: true,
      data: {
        id: profile.userId._id,
        name: profile.userId.name,
        artisanCode: profile.userId.artisanCode || null,
        memberSince: profile.userId.createdAt,
        profilePhoto: profile.profilePhoto?.url || null,
        skills: profile.skills,
        bio: profile.bio,
        badgeLevel: profile.badgeLevel,
        isPro: profile.isPro || false,
        location: {
          address: profile.location?.address || null,
          state: profile.location?.state || null,
          lga: profile.location?.lga || null,
        },
        stats: {
          completedJobs: profile.stats.completedJobs,
          averageRating: Math.round(profile.stats.averageRating * 10) / 10,
          totalRatings: profile.stats.totalRatings,
          cancelledJobs: profile.stats.cancelledJobs,
          disputeCount: profile.stats.disputeCount,
          avgResponseTimeMinutes: profile.stats.avgResponseTimeMinutes,
          onTimeArrivalRate: profile.stats.onTimeArrivalRate,
          acceptanceRate: profile.stats.acceptanceRate,
        },
        dispatchInfo: profile.skills?.includes('Dispatch Rider') ? (profile.dispatchInfo || null) : null,
      },
    });
  } catch (err) {
    console.error('getArtisanProfile error:', err);
    res.status(500).json({ success: false, message: 'Failed to load profile.' });
  }
};

// ─── GET /api/artisans/:artisanId/reviews — Paginated reviews for artisan ─────
exports.getArtisanReviews = async (req, res) => {
  try {
    const { artisanId } = req.params;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip  = (page - 1) * limit;

    const reviews = await Review.find({ artisanId })
      .populate('customerId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Review.countDocuments({ artisanId });

    res.status(200).json({
      success: true,
      data: reviews.map((r) => ({
        id: r._id,
        customerName: r.customerId?.name || 'Customer',
        ratings: r.ratings,
        overallScore: r.overallScore,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
      pagination: { page, limit, total },
    });
  } catch (err) {
    console.error('getArtisanReviews error:', err);
    res.status(500).json({ success: false, message: 'Failed to load reviews.' });
  }
};

// ─── POST /api/jobs/:jobId/rate — Customer rates artisan after completion ──────
exports.rateJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { quality, timeliness, communication, comment } = req.body;

    // Validate ratings
    const fields = { quality, timeliness, communication };
    for (const [key, val] of Object.entries(fields)) {
      const n = parseInt(val);
      if (!n || n < 1 || n > 5) {
        return res.status(400).json({
          success: false,
          message: `${key} must be a number between 1 and 5.`,
        });
      }
    }

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });

    // Only the customer who created the job can rate
    if (job.customerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the customer can rate this job.' });
    }

    if (job.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Job must be completed before rating.' });
    }

    if (!job.assignedArtisanId) {
      return res.status(400).json({ success: false, message: 'No artisan assigned to this job.' });
    }

    // Prevent double rating
    const existing = await Review.findOne({ jobId });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You have already rated this job.' });
    }

    const q = parseInt(quality);
    const t = parseInt(timeliness);
    const c = parseInt(communication);
    const overallScore = Math.round(((q + t + c) / 3) * 10) / 10;

    // ── Critical: create the review document ─────────────────────────────────
    const review = await Review.create({
      jobId,
      customerId: req.user._id,
      artisanId: job.assignedArtisanId,
      ratings: { quality: q, timeliness: t, communication: c },
      overallScore,
      comment: comment?.trim() || null,
    });

    // Non-critical: tell the artisan (notify never throws)
    notify(job.assignedArtisanId, 'review_received',
      'New Review',
      `${req.user.name} rated you ${overallScore}/5${comment?.trim() ? `: "${comment.trim().substring(0, 80)}"` : '.'}`,
      { jobId: String(jobId) }
    );

    // ── Non-critical: update artisan stats ────────────────────────────────────
    // Single atomic pipeline update — eliminates the read-modify-write race condition
    // that corrupts averageRating when two reviews submit simultaneously.
    // Badge level is recomputed inline since pre-save hook doesn't run on findOneAndUpdate.
    try {
      await ArtisanProfile.findOneAndUpdate(
        { userId: job.assignedArtisanId },
        [
          {
            $set: {
              'stats.averageRating': {
                $round: [
                  {
                    $divide: [
                      {
                        $add: [
                          { $multiply: [{ $ifNull: ['$stats.averageRating', 0] }, { $ifNull: ['$stats.totalRatings', 0] }] },
                          overallScore,
                        ],
                      },
                      { $add: [{ $ifNull: ['$stats.totalRatings', 0] }, 1] },
                    ],
                  },
                  2,
                ],
              },
              'stats.totalRatings': { $add: [{ $ifNull: ['$stats.totalRatings', 0] }, 1] },
            },
          },
          {
            $set: {
              badgeLevel: {
                $cond: [
                  { $ne: ['$verificationStatus', 'verified'] },
                  'new',
                  {
                    $cond: [
                      { $and: [{ $gte: ['$stats.completedJobs', 10] }, { $gte: ['$stats.averageRating', 3.5] }] },
                      'trusted',
                      'verified',
                    ],
                  },
                ],
              },
            },
          },
        ]
      );
    } catch (statsErr) {
      console.error('rateJob: artisan stats update failed (non-fatal):', statsErr.message);
    }

    // ── Non-critical: store rating on job for quick access ────────────────────
    try {
      await Job.findByIdAndUpdate(jobId, {
        $set: {
          'rating.score':   overallScore,
          'rating.review':  comment?.trim() || null,
          'rating.ratedAt': new Date(),
        },
      });
    } catch (jobErr) {
      console.error('rateJob: job rating update failed (non-fatal):', jobErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'Thank you for your review!',
      data: { overallScore, reviewId: review._id },
    });
  } catch (err) {
    console.error('rateJob error:', err.message);
    // Return the actual Mongoose/validation message so it's visible in the app during debugging
    const clientMessage = err.name === 'ValidationError'
      ? Object.values(err.errors).map((e) => e.message).join('. ')
      : err.code === 11000
        ? 'You have already rated this job.'
        : err.message || 'Failed to submit review.';
    res.status(500).json({ success: false, message: clientMessage });
  }
};

// ─── POST /api/artisan/bio — Artisan updates their bio ───────────────────────
exports.updateBio = async (req, res) => {
  try {
    const { bio } = req.body;

    if (!bio || !bio.trim()) {
      return res.status(400).json({ success: false, message: 'Bio cannot be empty.' });
    }

    if (bio.trim().length > 300) {
      return res.status(400).json({ success: false, message: 'Bio must be 300 characters or less.' });
    }

    const profile = await ArtisanProfile.findOne({ userId: req.user._id });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found.' });

    profile.bio = bio.trim();
    await profile.save();

    res.status(200).json({ success: true, message: 'Bio updated.', data: { bio: profile.bio } });
  } catch (err) {
    console.error('updateBio error:', err);
    res.status(500).json({ success: false, message: 'Failed to update bio.' });
  }
};

// ─── POST /api/complaints — Customer submits a complaint ─────────────────────
exports.createComplaint = async (req, res) => {
  try {
    const { jobId, reason } = req.body;

    if (!jobId || !reason?.trim()) {
      return res.status(400).json({ success: false, message: 'jobId and reason are required.' });
    }

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });

    // Must be a party to this job
    const isCustomer = job.customerId.toString() === req.user._id.toString();
    const isArtisan = job.assignedArtisanId?.toString() === req.user._id.toString();

    if (!isCustomer && !isArtisan) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const againstUserId = isCustomer ? job.assignedArtisanId : job.customerId;
    if (!againstUserId) {
      return res.status(400).json({ success: false, message: 'No party to complain against.' });
    }

    const Complaint = require('../models/Complaint');
    const complaint = await Complaint.create({
      jobId,
      submittedBy: req.user._id,
      againstUserId,
      reason: reason.trim(),
    });

    // Increment artisan dispute count if complaint is against the artisan
    if (isCustomer && job.assignedArtisanId) {
      await ArtisanProfile.findOneAndUpdate(
        { userId: job.assignedArtisanId },
        { $inc: { 'stats.disputeCount': 1 } }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Complaint submitted. Admin will review within 24 hours.',
      data: { complaintId: complaint._id },
    });
  } catch (err) {
    console.error('createComplaint error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit complaint.' });
  }
};
