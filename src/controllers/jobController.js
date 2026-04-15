const Job = require('../models/Job');
const ArtisanProfile = require('../models/ArtisanProfile');
const User = require('../models/User');
const cloudinary = require('../config/cloudinary');
const { emitToUsers, emitToUser } = require('../socket');
const { notify } = require('./notificationController');

// Search radius in meters — artisans within this range get notified
const NORMAL_JOB_RADIUS_METERS = 10000;  // 10km
const EMERGENCY_JOB_RADIUS_METERS = 20000; // 20km — cast wider net for emergencies

// ─── Helper: delete cloudinary images on job cancel/error ─────────────────────
const deleteJobImages = async (images = []) => {
  for (const img of images) {
    if (img.publicId) {
      try {
        await cloudinary.uploader.destroy(img.publicId);
      } catch (e) {
        console.warn('Could not delete job image:', img.publicId);
      }
    }
  }
};

// ─── POST /api/jobs — Customer creates a job ─────────────────────────────────
exports.createJob = async (req, res) => {
  try {
    const { category, description, urgency, latitude, longitude, address, state, lga, artisanId } = req.body;

    // Validate required fields
    if (!category || !description) {
      return res.status(400).json({ success: false, message: 'Category and description are required.' });
    }

    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'Job location coordinates are required.' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ success: false, message: 'Invalid coordinates.' });
    }

    // Build images array from uploaded files
    const images = (req.files || []).map((f) => ({
      url: f.path,
      publicId: f.filename,
    }));

    // remote = 7 days, emergency = 2 hours, normal = 24 hours
    const expiryMs =
      urgency === 'remote'    ? 7 * 24 * 60 * 60 * 1000 :
      urgency === 'emergency' ? 2 * 60 * 60 * 1000 :
                                24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + expiryMs);

    const jobDoc = {
      customerId: req.user._id,
      category,
      description,
      images,
      urgency: urgency || 'normal',
      location: {
        type: 'Point',
        coordinates: [lng, lat],
        address: address || null,
        state: state || null,
        lga: lga || null,
      },
      expiresAt,
    };

    // Direct request to a specific artisan — assign immediately
    if (artisanId) {
      jobDoc.assignedArtisanId = artisanId;
    }

    const job = await Job.create(jobDoc);

    // ── Notify artisans ────────────────────────────────────────────────────────
    let artisanUserIds = [];
    let targetArtisanName = null;

    if (artisanId) {
      // Direct request: notify only the chosen artisan
      const targetUser = await User.findById(artisanId).select('name').lean();
      targetArtisanName = targetUser?.name || null;
      artisanUserIds = [artisanId];
      await Job.findByIdAndUpdate(job._id, { notifiedArtisans: artisanUserIds });
      emitToUser(artisanId.toString(), 'new_job', {
        jobId: job._id,
        category: job.category,
        urgency: job.urgency,
        description: job.description.substring(0, 120),
        address: job.location.address,
        state: job.location.state,
        createdAt: job.createdAt,
        expiresAt: job.expiresAt,
        isDirect: true,
      });
      notify(artisanId, 'new_job',
        'New Direct Job Request',
        `New ${job.category} job: ${job.description.substring(0, 80)}`,
        { jobId: job._id.toString() }
      );
    } else {
      // Broadcast: notify nearby verified artisans with matching skill
      let nearbyProfiles;
      if (urgency === 'remote') {
        nearbyProfiles = await ArtisanProfile.find({
          verificationStatus: 'verified',
          skills: category,
        }).select('userId').lean();
      } else {
        const radius = urgency === 'emergency' ? EMERGENCY_JOB_RADIUS_METERS : NORMAL_JOB_RADIUS_METERS;
        nearbyProfiles = await ArtisanProfile.find({
          verificationStatus: 'verified',
          skills: category,
          location: {
            $near: {
              $geometry: { type: 'Point', coordinates: [lng, lat] },
              $maxDistance: radius,
            },
          },
        }).select('userId').lean();
      }

      artisanUserIds = nearbyProfiles.map((p) => p.userId);

      if (artisanUserIds.length > 0) {
        await Job.findByIdAndUpdate(job._id, { notifiedArtisans: artisanUserIds });
        emitToUsers(artisanUserIds, 'new_job', {
          jobId: job._id,
          category: job.category,
          urgency: job.urgency,
          description: job.description.substring(0, 120),
          address: job.location.address,
          state: job.location.state,
          createdAt: job.createdAt,
          expiresAt: job.expiresAt,
        });
        // Persist notification for each notified artisan (non-blocking)
        const area = job.location.state || job.location.address || 'your area';
        artisanUserIds.forEach((uid) =>
          notify(uid, 'job_broadcast',
            'New Job Near You',
            `${job.category} job in ${area}. ${job.description.substring(0, 60)}`,
            { jobId: job._id.toString() }
          )
        );
      }
    }

    res.status(201).json({
      success: true,
      message: artisanId
        ? 'Job request sent to artisan.'
        : 'Job created. Nearby artisans are being notified.',
      data: {
        jobId: job._id,
        status: job.status,
        urgency: job.urgency,
        artisansNotified: artisanUserIds.length,
        targetArtisanName,
        expiresAt: job.expiresAt,
      },
    });
  } catch (err) {
    console.error('createJob error:', err);
    // Clean up any uploaded images if job creation failed
    if (req.files?.length) {
      await deleteJobImages(req.files.map((f) => ({ publicId: f.filename })));
    }
    res.status(500).json({ success: false, message: 'Failed to create job. Please try again.' });
  }
};

// ─── GET /api/jobs/available — Artisan fetches available jobs near them ────────
exports.getAvailableJobs = async (req, res) => {
  try {
    const profile = req.artisanProfile; // set by requireVerified middleware

    const [lng, lat] = profile.location.coordinates;
    const radius = 15000; // 15km default browse radius

    const jobs = await Job.find({
      status: 'pending',
      category: { $in: profile.skills },
      expiresAt: { $gt: new Date() },
      declinedBy: { $ne: req.user._id }, // hide jobs artisan already declined
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: radius,
        },
      },
    })
      .populate('customerId', 'name')
      .select('-notifiedArtisans -declinedBy')
      .lean();

    res.status(200).json({ success: true, count: jobs.length, data: jobs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Could not fetch jobs.' });
  }
};

// ─── POST /api/jobs/:jobId/accept — Artisan accepts a job ─────────────────────
exports.acceptJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { estimatedArrivalMinutes, agreedPrice } = req.body;

    const job = await Job.findById(jobId);

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found.' });
    }

    if (job.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: job.status === 'accepted'
          ? 'This job has already been accepted by another artisan.'
          : `Job is ${job.status} and cannot be accepted.`,
      });
    }

    if (job.expiresAt && job.expiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'This job has expired.' });
    }

    if (job.declinedBy.includes(req.user._id)) {
      return res.status(400).json({ success: false, message: 'You previously declined this job.' });
    }

    // Accept
    job.status = 'accepted';
    job.assignedArtisanId = req.user._id;
    job.estimatedArrivalMinutes = estimatedArrivalMinutes || null;
    job.agreedPrice = agreedPrice || null;
    job.timeline.acceptedAt = new Date();

    await job.save();

    // Notify customer
    const artisan = await User.findById(req.user._id).select('name');
    emitToUser(job.customerId.toString(), 'job_accepted', {
      jobId: job._id,
      artisanId: req.user._id,
      artisanName: artisan.name,
      estimatedArrivalMinutes: job.estimatedArrivalMinutes,
      agreedPrice: job.agreedPrice,
    });
    const eta = job.estimatedArrivalMinutes ? ` ETA: ${job.estimatedArrivalMinutes} mins.` : '';
    notify(job.customerId, 'job_accepted',
      'Artisan Accepted Your Job',
      `${artisan.name} has accepted your ${job.category} request.${eta}`,
      { jobId: job._id.toString(), senderName: artisan.name }
    );

    // Notify other artisans who were notified that job is now taken
    const othersToNotify = job.notifiedArtisans.filter(
      (id) => id.toString() !== req.user._id.toString()
    );
    if (othersToNotify.length > 0) {
      emitToUsers(othersToNotify, 'job_taken', { jobId: job._id });
    }

    res.status(200).json({
      success: true,
      message: 'Job accepted. Customer has been notified.',
      data: {
        jobId: job._id,
        status: job.status,
        estimatedArrivalMinutes: job.estimatedArrivalMinutes,
        agreedPrice: job.agreedPrice,
        customerLocation: {
          address: job.location.address,
          state: job.location.state,
          coordinates: job.location.coordinates,
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to accept job.' });
  }
};

// ─── POST /api/jobs/:jobId/decline — Artisan declines a job ───────────────────
exports.declineJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await Job.findById(jobId);

    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });
    if (job.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Job is no longer available.' });
    }

    // Mark as declined — this artisan won't see it again
    if (!job.declinedBy.includes(req.user._id)) {
      job.declinedBy.push(req.user._id);
      await job.save();
    }

    // Notify customer only on direct requests (assignedArtisanId was set at creation)
    const wasDirectRequest = job.assignedArtisanId?.toString() === req.user._id.toString();
    if (wasDirectRequest) {
      const decliningArtisan = await User.findById(req.user._id).select('name').lean();
      notify(job.customerId, 'job_declined',
        'Job Request Declined',
        `${decliningArtisan?.name || 'The artisan'} is unavailable for your ${job.category} request.`,
        { jobId: job._id.toString() }
      );
    }

    res.status(200).json({ success: true, message: 'Job declined.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to decline job.' });
  }
};

// ─── POST /api/jobs/:jobId/arrived — Artisan marks arrival ────────────────────
exports.markArrived = async (req, res) => {
  try {
    const job = await Job.findOne({
      _id: req.params.jobId,
      assignedArtisanId: req.user._id,
      status: 'accepted',
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found or you are not assigned to it.',
      });
    }

    const now = new Date();
    job.timeline.artisanArrivedAt = now;
    job.status = 'in-progress';
    job.timeline.startedAt = now;

    // Check if artisan arrived within estimated window (with 15-min buffer for Lagos traffic)
    if (job.timeline.acceptedAt && job.estimatedArrivalMinutes) {
      const expectedArrival = new Date(
        job.timeline.acceptedAt.getTime() + (job.estimatedArrivalMinutes + 15) * 60 * 1000
      );
      job.arrivedOnTime = now <= expectedArrival;
    }

    await job.save();

    // Notify customer
    emitToUser(job.customerId.toString(), 'artisan_arrived', {
      jobId: job._id,
      arrivedAt: now,
      status: 'in-progress',
    });
    notify(job.customerId, 'artisan_arrived',
      'Artisan Has Arrived',
      `Your ${job.category} artisan has arrived. Work is now in progress.`,
      { jobId: job._id.toString() }
    );

    res.status(200).json({
      success: true,
      message: 'Arrival confirmed. Job is now in progress.',
      data: { jobId: job._id, status: job.status, arrivedAt: now },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to mark arrival.' });
  }
};

// ─── POST /api/jobs/:jobId/complete — Artisan marks job complete ───────────────
exports.markCompleted = async (req, res) => {
  try {
    const job = await Job.findOne({
      _id: req.params.jobId,
      assignedArtisanId: req.user._id,
      status: 'in-progress',
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found or not in progress.',
      });
    }

    job.status = 'completed';
    job.timeline.completedAt = new Date();
    await job.save();

    // Update artisan stats
    await ArtisanProfile.findOneAndUpdate(
      { userId: req.user._id },
      {
        $inc: {
          'stats.completedJobs': 1,
          'stats.totalJobs': 1,
        },
      }
    );

    // Notify customer — prompt them to confirm and rate
    emitToUser(job.customerId.toString(), 'job_completed', {
      jobId: job._id,
      completedAt: job.timeline.completedAt,
      message: 'Artisan has marked the job as complete. Please confirm and rate.',
    });
    notify(job.customerId, 'job_completed',
      'Job Completed — Please Rate',
      `Your ${job.category} job has been marked complete. Tap to confirm and leave a review.`,
      { jobId: job._id.toString() }
    );

    res.status(200).json({
      success: true,
      message: 'Job marked as complete. Waiting for customer confirmation.',
      data: { jobId: job._id, status: job.status },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to complete job.' });
  }
};

// ─── POST /api/jobs/:jobId/dispute — Customer or artisan raises a dispute ──────
exports.raiseDispute = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'Dispute reason is required.' });
    }

    const job = await Job.findById(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });

    const isCustomer = job.customerId.toString() === req.user._id.toString();
    const isArtisan = job.assignedArtisanId?.toString() === req.user._id.toString();

    if (!isCustomer && !isArtisan) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    if (!['accepted', 'in-progress', 'completed'].includes(job.status)) {
      return res.status(400).json({
        success: false,
        message: 'Disputes can only be raised for active or recently completed jobs.',
      });
    }

    if (job.status === 'disputed') {
      return res.status(400).json({ success: false, message: 'A dispute is already open for this job.' });
    }

    const raisedBy = isCustomer ? 'customer' : 'artisan';
    const prevStatus = job.status;

    job.status = 'disputed';
    job.dispute = {
      raisedBy,
      reason: reason.trim(),
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
    };
    job.timeline.disputedAt = new Date();

    await job.save();

    // Update artisan dispute count
    if (isCustomer && job.assignedArtisanId) {
      await ArtisanProfile.findOneAndUpdate(
        { userId: job.assignedArtisanId },
        { $inc: { 'stats.disputeCount': 1 } }
      );
    }

    // Notify the other party
    const notifyUserId = isCustomer
      ? job.assignedArtisanId?.toString()
      : job.customerId.toString();

    if (notifyUserId) {
      emitToUser(notifyUserId, 'dispute_raised', {
        jobId: job._id,
        raisedBy,
        reason: reason.trim(),
        previousStatus: prevStatus,
      });
      const raisedByLabel = raisedBy === 'customer' ? 'The customer' : 'The artisan';
      notify(notifyUserId, 'dispute_raised',
        'Dispute Raised',
        `${raisedByLabel} has raised a dispute on your ${job.category} job. An admin will review within 24 hours.`,
        { jobId: job._id.toString() }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Dispute raised. An admin will review and resolve within 24 hours.',
      data: { jobId: job._id, status: job.status, raisedBy },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to raise dispute.' });
  }
};

// ─── POST /api/jobs/:jobId/cancel — Cancel a pending/accepted job ──────────────
exports.cancelJob = async (req, res) => {
  try {
    const { reason } = req.body;
    const job = await Job.findById(req.params.jobId);

    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });

    const isCustomer = job.customerId.toString() === req.user._id.toString();
    const isArtisan = job.assignedArtisanId?.toString() === req.user._id.toString();

    if (!isCustomer && !isArtisan) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    // Only pending or accepted jobs can be cancelled
    if (!['pending', 'accepted'].includes(job.status)) {
      return res.status(400).json({
        success: false,
        message: `A job that is ${job.status} cannot be cancelled. Raise a dispute instead.`,
      });
    }

    const cancelledBy = isCustomer ? 'customer' : 'artisan';

    job.status = 'cancelled';
    job.timeline.cancelledAt = new Date();
    job.cancellation = { cancelledBy, reason: reason?.trim() || null };

    await job.save();

    if (isArtisan) {
      await ArtisanProfile.findOneAndUpdate(
        { userId: req.user._id },
        { $inc: { 'stats.cancelledJobs': 1, 'stats.totalJobs': 1 } }
      );
    }

    // Notify the other party
    const notifyUserId = isCustomer
      ? job.assignedArtisanId?.toString()
      : job.customerId.toString();

    if (notifyUserId) {
      emitToUser(notifyUserId, 'job_cancelled', {
        jobId: job._id,
        cancelledBy,
        reason: job.cancellation.reason,
      });
      const cancelledByLabel = cancelledBy === 'customer' ? 'The customer' : 'The artisan';
      notify(notifyUserId, 'job_cancelled',
        'Job Cancelled',
        `${cancelledByLabel} has cancelled the ${job.category} job.`,
        { jobId: job._id.toString() }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Job cancelled.',
      data: { jobId: job._id, status: job.status },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to cancel job.' });
  }
};

// ─── GET /api/jobs/:jobId — Get single job detail ─────────────────────────────
exports.getJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId)
      .populate('customerId', 'name')
      .populate('assignedArtisanId', 'name')
      .lean();

    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });

    const userId = req.user._id.toString();
    const isCustomer = job.customerId._id.toString() === userId;
    const isArtisan = job.assignedArtisanId?._id?.toString() === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isCustomer && !isArtisan && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this job.' });
    }

    // Strip internal arrays from non-admin response
    if (!isAdmin) {
      delete job.notifiedArtisans;
      delete job.declinedBy;
    }

    res.status(200).json({ success: true, data: job });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch job.' });
  }
};

// ─── GET /api/jobs/my — Customer or artisan sees their own jobs ────────────────
exports.getMyJobs = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query =
      req.user.role === 'customer'
        ? { customerId: req.user._id }
        : { assignedArtisanId: req.user._id };

    if (status) query.status = status;

    const jobs = await Job.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('customerId', 'name')
      .populate('assignedArtisanId', 'name')
      .select('-notifiedArtisans -declinedBy')
      .lean();

    const total = await Job.countDocuments(query);

    res.status(200).json({
      success: true,
      data: jobs,
      pagination: { page: parseInt(page), limit: parseInt(limit), total },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch jobs.' });
  }
};
