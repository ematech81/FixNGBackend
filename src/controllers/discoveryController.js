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

// ─── GET /api/artisans — Search nearby verified artisans ─────────────────────
// Query params: category, latitude, longitude, maxDistance (km), minRating, page
exports.searchArtisans = async (req, res) => {
  try {
    const {
      category,
      latitude,
      longitude,
      maxDistance = 20, // km default
      minRating = 0,
      page = 1,
      limit = 20,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build geo query if coordinates provided
    const query = {
      verificationStatus: 'verified',
      isSuspended: { $ne: true },
      isBanned: { $ne: true },
    };

    if (category) {
      query.skills = category;
    }

    if (minRating > 0) {
      query['stats.averageRating'] = { $gte: parseFloat(minRating) };
    }

    let profiles;

    if (latitude && longitude) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const radiusMeters = parseFloat(maxDistance) * 1000;

      profiles = await ArtisanProfile.find({
        ...query,
        location: {
          $near: {
            $geometry: { type: 'Point', coordinates: [lng, lat] },
            $maxDistance: radiusMeters,
          },
        },
      })
        .populate('userId', 'name')
        .select('userId profilePhoto skills bio location stats badgeLevel')
        .skip(skip)
        .limit(parseInt(limit))
        .lean();
    } else {
      // No location — return by rating desc
      profiles = await ArtisanProfile.find(query)
        .sort({ 'stats.averageRating': -1, 'stats.completedJobs': -1 })
        .populate('userId', 'name')
        .select('userId profilePhoto skills bio location stats badgeLevel')
        .skip(skip)
        .limit(parseInt(limit))
        .lean();
    }

    const userLat = latitude ? parseFloat(latitude) : null;
    const userLng = longitude ? parseFloat(longitude) : null;

    const artisans = profiles.map((p) => {
      let distanceKm = null;
      if (userLat && userLng && p.location?.coordinates?.length === 2) {
        const [artisanLng, artisanLat] = p.location.coordinates;
        distanceKm = Math.round(haversineKm(userLat, userLng, artisanLat, artisanLng) * 10) / 10;
      }
      return {
        id: p.userId?._id,
        name: p.userId?.name,
        profilePhoto: p.profilePhoto?.url || null,
        skills: p.skills,
        bio: p.bio,
        address: p.location?.address || null,
        state: p.location?.state || null,
        badgeLevel: p.badgeLevel,
        distanceKm,
        stats: {
          completedJobs: p.stats.completedJobs,
          averageRating: p.stats.averageRating,
          totalRatings: p.stats.totalRatings,
          avgResponseTimeMinutes: p.stats.avgResponseTimeMinutes,
        },
      };
    });

    res.status(200).json({ success: true, count: artisans.length, data: artisans });
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
      .populate('userId', 'name createdAt')
      .lean();

    if (!profile || profile.verificationStatus !== 'verified') {
      return res.status(404).json({ success: false, message: 'Artisan profile not found.' });
    }

    if (profile.isBanned || profile.isSuspended) {
      return res.status(404).json({ success: false, message: 'Artisan profile not found.' });
    }

    res.status(200).json({
      success: true,
      data: {
        id: profile.userId._id,
        name: profile.userId.name,
        memberSince: profile.userId.createdAt,
        profilePhoto: profile.profilePhoto?.url || null,
        skills: profile.skills,
        bio: profile.bio,
        badgeLevel: profile.badgeLevel,
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
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reviews = await Review.find({ artisanId })
      .populate('customerId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
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
      pagination: { page: parseInt(page), limit: parseInt(limit), total },
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

    const review = await Review.create({
      jobId,
      customerId: req.user._id,
      artisanId: job.assignedArtisanId,
      ratings: { quality: q, timeliness: t, communication: c },
      overallScore,
      comment: comment?.trim() || null,
    });

    // Update artisan average rating
    const artisanProfile = await ArtisanProfile.findOne({ userId: job.assignedArtisanId });
    if (artisanProfile) {
      const prevTotal = artisanProfile.stats.totalRatings;
      const prevAvg = artisanProfile.stats.averageRating;
      const newTotal = prevTotal + 1;
      const newAvg = (prevAvg * prevTotal + overallScore) / newTotal;

      artisanProfile.stats.averageRating = Math.round(newAvg * 100) / 100;
      artisanProfile.stats.totalRatings = newTotal;
      await artisanProfile.save(); // triggers badge recomputation
    }

    // Store rating on job for quick access
    await Job.findByIdAndUpdate(jobId, {
      rating: { score: overallScore, review: comment?.trim() || null, ratedAt: new Date() },
    });

    res.status(201).json({
      success: true,
      message: 'Thank you for your review!',
      data: { overallScore, reviewId: review._id },
    });
  } catch (err) {
    console.error('rateJob error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit review.' });
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
