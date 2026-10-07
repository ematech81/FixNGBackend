const Job = require('../models/Job');
const ArtisanProfile = require('../models/ArtisanProfile');
const User = require('../models/User');
const Complaint = require('../models/Complaint');
const cloudinary = require('../config/cloudinary');
const { emitToUsers, emitToUser } = require('../socket');
const { notify } = require('./notificationController');
const { emailUser } = require('../utils/emailNotifications');
const { smsDirectJobAlert } = require('../utils/jobAlertSms');
const Notification = require('../models/Notification');
const { GRACE_MINUTES, WARN_RULES, reasonsFor } = require('../constants/cancellation');
const { TIER_LIMITS, getArtisanPlan } = require('../utils/subscriptionLimits');

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
    const { title, category, description, urgency, latitude, longitude, address, state, lga, artisanId } = req.body;

    // Validate required fields
    if (!category || !description) {
      return res.status(400).json({ success: false, message: 'Category and description are required.' });
    }

    const lat = latitude  ? parseFloat(latitude)  : null;
    const lng = longitude ? parseFloat(longitude) : null;
    const hasCoords = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng);

    // Build images array from uploaded files
    // req.files is an object when using multer.fields(): { images: [...], voiceDescription: [...] }
    const imageFiles = Array.isArray(req.files) ? req.files : (req.files?.images || []);
    const images = imageFiles.map((f) => ({
      url: f.path,
      publicId: f.filename,
    }));

    // Optional voice description
    const voiceFile = Array.isArray(req.files) ? null : req.files?.voiceDescription?.[0];
    const voiceDescriptionDoc = voiceFile
      ? { url: voiceFile.path, publicId: voiceFile.filename, duration: req.body.voiceDuration ? parseFloat(req.body.voiceDuration) : null }
      : undefined;

    // remote = 7 days, emergency = 2 hours, normal = 24 hours
    const expiryMs =
      urgency === 'remote'    ? 7 * 24 * 60 * 60 * 1000 :
      urgency === 'emergency' ? 2 * 60 * 60 * 1000 :
                                24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + expiryMs);

    const jobDoc = {
      customerId: req.user._id,
      title: title?.trim() || null,
      category,
      description,
      images,
      urgency: urgency || 'normal',
      location: {
        ...(hasCoords ? { type: 'Point', coordinates: [lng, lat] } : {}),
        address: address || null,
        state: state || null,
        lga: lga || null,
      },
      expiresAt,
    };

    if (voiceDescriptionDoc) {
      jobDoc.voiceDescription = voiceDescriptionDoc;
    }

    // Direct request to a specific artisan — assign immediately and stamp artisanCode
    let _directArtisan = null;
    if (artisanId) {
      jobDoc.assignedArtisanId = artisanId;
      _directArtisan = await User.findById(artisanId).select('name artisanCode').lean();
      if (_directArtisan?.artisanCode) {
        jobDoc.artisanCode = _directArtisan.artisanCode;
      }
    }

    const job = await Job.create(jobDoc);

    // ── Notify artisans ────────────────────────────────────────────────────────
    let artisanUserIds = [];
    let targetArtisanName = null;

    if (artisanId) {
      // Direct request: notify only the chosen artisan
      targetArtisanName = _directArtisan?.name || null;
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
      emailUser(artisanId, 'job_request', {
        category: job.category,
        description: job.description.substring(0, 160),
        location: job.location.state || job.location.address,
        isDirect: true,
      });
      smsDirectJobAlert(artisanId, { category: job.category });
    } else {
      // Broadcast: notify nearby verified artisans with matching skill
      let nearbyProfiles;
      if (urgency === 'remote') {
        nearbyProfiles = await ArtisanProfile.find({
          verificationStatus: 'verified',
          skills: category,
        }).select('userId').lean();
      } else if (hasCoords) {
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
      } else {
        // No GPS — notify verified artisans in the same state (or all if state unknown)
        const stateFilter = state ? { 'location.state': state } : {};
        nearbyProfiles = await ArtisanProfile.find({
          verificationStatus: 'verified',
          skills: category,
          ...stateFilter,
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

    // Pre-checks: load job for validation before the atomic write
    const existing = await Job.findById(jobId);

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Job not found.' });
    }

    if (existing.status !== 'pending') {
      return res.status(409).json({
        success: false,
        message: existing.status === 'accepted'
          ? 'Job already accepted.'
          : `Job is ${existing.status} and cannot be accepted.`,
      });
    }

    if (existing.expiresAt && existing.expiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'This job has expired.' });
    }

    if (existing.declinedBy.includes(req.user._id)) {
      return res.status(400).json({ success: false, message: 'You previously declined this job.' });
    }

    // Subscription tier limit check
    const plan = await getArtisanPlan(req.user._id);
    const limit = TIER_LIMITS[plan]?.maxActiveJobs ?? 2;

    if (isFinite(limit)) {
      const activeCount = await Job.countDocuments({
        assignedArtisanId: req.user._id,
        status: { $in: ['accepted', 'in-progress'] },
      });
      if (activeCount >= limit) {
        return res.status(403).json({
          success: false,
          limitReached: true,
          currentPlan: plan,
          requiredPlan: 'pro',
          message: `Free accounts can only hold ${limit} active jobs at a time. Subscribe to Pro for unlimited jobs.`,
        });
      }
    }

    // Atomic accept: only succeeds if status is still 'pending' at write time.
    // If two artisans pass the checks above simultaneously, exactly one wins here.
    const job = await Job.findOneAndUpdate(
      { _id: jobId, status: 'pending' },
      {
        $set: {
          status: 'accepted',
          assignedArtisanId: req.user._id,
          artisanCode: req.user.artisanCode || null,
          estimatedArrivalMinutes: estimatedArrivalMinutes || null,
          agreedPrice: agreedPrice || null,
          'timeline.acceptedAt': new Date(),
        },
      },
      { new: true }
    );

    if (!job) {
      return res.status(409).json({ success: false, message: 'Job already accepted.' });
    }

    // Notify customer
    const artisan = await User.findById(req.user._id).select('name artisanCode');
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
    emailUser(job.customerId, 'job_accepted', {
      artisanName: artisan.name,
      category: job.category,
      eta: job.estimatedArrivalMinutes,
    });

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

    // Atomic add-to-set — safe under concurrent requests (no duplicate ids, no overwrite)
    await Job.findByIdAndUpdate(jobId, { $addToSet: { declinedBy: req.user._id } });

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
    const now = new Date();

    // Atomic: only succeeds if still in-progress and assigned to this artisan.
    // Prevents double-completion if the request fires twice.
    const job = await Job.findOneAndUpdate(
      {
        _id: req.params.jobId,
        assignedArtisanId: req.user._id,
        status: 'in-progress',
      },
      {
        $set: {
          status: 'completed',
          'timeline.completedAt': now,
        },
      },
      { new: true }
    );

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found or not in progress.',
      });
    }

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

    // Atomic status update — prevents two simultaneous disputes creating duplicate Complaints
    const updated = await Job.findOneAndUpdate(
      { _id: req.params.jobId, status: { $in: ['accepted', 'in-progress', 'completed'] } },
      {
        $set: {
          status: 'disputed',
          'dispute.raisedBy': raisedBy,
          'dispute.reason': reason.trim(),
          'dispute.resolution': null,
          'dispute.resolvedAt': null,
          'dispute.resolvedBy': null,
          'timeline.disputedAt': new Date(),
        },
      },
      { new: true }
    );

    if (!updated) {
      return res.status(409).json({ success: false, message: 'A dispute is already open or job status changed.' });
    }

    // Create a Complaint record so the dispute appears in the admin dashboard
    const againstUserId = isCustomer ? job.assignedArtisanId : job.customerId;
    if (againstUserId) {
      await Complaint.create({
        jobId: job._id,
        submittedBy: req.user._id,
        againstUserId,
        reason: `[${raisedBy === 'customer' ? 'Customer' : 'Artisan'} Dispute – ${job.category}] ${reason.trim()}`,
      });
    }

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

// ─── Cancellation policy ──────────────────────────────────────────────────────
// Rules are documented in constants/cancellation.js. This works out, for one job and one
// user, whether cancelling is allowed, what it will cost them, and which reasons to offer.
const sinceDays = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

const countCustomerLateCancels = (customerId) => Job.countDocuments({
  customerId,
  'cancellation.cancelledBy': 'customer',
  'cancellation.isLate': true,
  'timeline.cancelledAt': { $gte: sinceDays(WARN_RULES.customer.windowDays) },
});

const countArtisanCancels = (artisanId) => Job.countDocuments({
  assignedArtisanId: artisanId,
  'cancellation.cancelledBy': 'artisan',
  'timeline.cancelledAt': { $gte: sinceDays(WARN_RULES.artisan.windowDays) },
});

const evaluateCancel = async (job, user) => {
  const uid = user._id.toString();
  const isCustomer = job.customerId.toString() === uid;
  const isArtisan = job.assignedArtisanId?.toString() === uid;
  if (!isCustomer && !isArtisan) return { forbidden: true, allowed: false, message: 'Not authorized.' };

  const role = isCustomer ? 'customer' : 'artisan';
  const base = { role, status: job.status, reasons: reasonsFor(role), graceMinutes: GRACE_MINUTES };

  if (job.status === 'pending') {
    if (role === 'artisan') {
      return { ...base, allowed: false, message: 'You have not accepted this request yet. Use Decline instead.' };
    }
    return { ...base, allowed: true, phase: 'pending', isLate: false, message: 'Free to cancel — no artisan has accepted yet.' };
  }

  if (job.status === 'accepted') {
    if (role === 'customer') {
      const acceptedAt = job.timeline?.acceptedAt ? new Date(job.timeline.acceptedAt) : new Date(job.updatedAt);
      const minutesSince = (Date.now() - acceptedAt.getTime()) / 60000;
      const isLate = minutesSince > GRACE_MINUTES;
      const lateCancellations = await countCustomerLateCancels(user._id);
      return {
        ...base, allowed: true, phase: 'accepted', isLate, lateCancellations,
        graceMinutesLeft: isLate ? 0 : Math.max(1, Math.ceil(GRACE_MINUTES - minutesSince)),
        message: isLate
          ? `The artisan accepted this job more than ${GRACE_MINUTES} minutes ago. You can still cancel, but it counts as a late cancellation and the artisan will be told. ${WARN_RULES.customer.threshold} late cancellations within ${WARN_RULES.customer.windowDays} days lead to an account warning.`
          : `Free cancellation — you have about ${Math.max(1, Math.ceil(GRACE_MINUTES - minutesSince))} minute(s) left to cancel without a late-cancellation record.`,
      };
    }
    const cancellations = await countArtisanCancels(user._id);
    return {
      ...base, allowed: true, phase: 'accepted', isLate: true, cancellations,
      message: `The customer is expecting you. Cancelling an accepted job counts against your record, and ${WARN_RULES.artisan.threshold} cancellations within ${WARN_RULES.artisan.windowDays} days lead to an account warning. You have cancelled ${cancellations} in that period.`,
    };
  }

  if (job.status === 'in-progress') {
    return { ...base, allowed: false, canDispute: true, message: 'The artisan has arrived and work has started, so this job can no longer be cancelled. If something is wrong, raise a dispute and an admin will review it.' };
  }

  return { ...base, allowed: false, message: `A job that is ${job.status} cannot be cancelled.` };
};

// ─── GET /api/jobs/:jobId/cancel-policy — What cancelling would mean right now ─
exports.getCancelPolicy = async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });
    const policy = await evaluateCancel(job, req.user);
    if (policy.forbidden) return res.status(403).json({ success: false, message: policy.message });
    res.status(200).json({ success: true, data: policy });
  } catch (err) {
    console.error('getCancelPolicy error:', err);
    res.status(500).json({ success: false, message: 'Could not load the cancellation policy.' });
  }
};

// ─── POST /api/jobs/:jobId/cancel — Cancel a pending/accepted job ──────────────
// Body: { reasonCode, note? }.  Clients that predate reason codes (old mobile builds send no
// x-client header) may still cancel with no reason; web and new builds must give one.
exports.cancelJob = async (req, res) => {
  try {
    const { reasonCode, note, reason } = req.body;
    const job = await Job.findById(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });

    const policy = await evaluateCancel(job, req.user);
    if (policy.forbidden) return res.status(403).json({ success: false, message: policy.message });
    if (!policy.allowed) {
      return res.status(400).json({ success: false, canDispute: !!policy.canDispute, message: policy.message });
    }

    const role = policy.role;                     // 'customer' | 'artisan'
    const legacyClient = !req.headers['x-client'];
    const cleanNote = (note || '').trim().slice(0, 300);

    let code = reasonCode;
    let label = null;
    if (!code) {
      if (!legacyClient) {
        return res.status(400).json({ success: false, message: 'Please choose a reason for cancelling.' });
      }
      code = reason?.trim() ? 'other' : 'unspecified';   // old app: free-text reason or none
    } else {
      const found = policy.reasons.find((r) => r.code === code);
      if (!found) return res.status(400).json({ success: false, message: 'That is not a valid cancellation reason.' });
      label = found.label;
      if (code === 'other' && cleanNote.length < 5) {
        return res.status(400).json({ success: false, message: 'Please tell us the reason (at least 5 characters).' });
      }
    }
    const reasonText = label
      ? [label, cleanNote].filter(Boolean).join(' — ')
      : (reason?.trim() || cleanNote || null);

    // Atomic update — also requires the status we evaluated, so an artisan marking "arrived"
    // in the same moment can't be overridden by a cancel.
    const updated = await Job.findOneAndUpdate(
      { _id: req.params.jobId, status: job.status },
      {
        $set: {
          status: 'cancelled',
          'timeline.cancelledAt': new Date(),
          'cancellation.cancelledBy': role,
          'cancellation.reason': reasonText,
          'cancellation.reasonCode': code,
          'cancellation.note': cleanNote || null,
          'cancellation.phase': policy.phase,
          'cancellation.isLate': !!policy.isLate,
        },
      },
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({ success: false, message: 'This job just changed. Please refresh and check its status.' });
    }

    if (role === 'artisan') {
      await ArtisanProfile.findOneAndUpdate(
        { userId: req.user._id },
        { $inc: { 'stats.cancelledJobs': 1, 'stats.totalJobs': 1 } }
      );
    }

    // Tell the other party (in-app + push + email, with the reason)
    const notifyUserId = role === 'customer' ? job.assignedArtisanId?.toString() : job.customerId.toString();
    if (notifyUserId) {
      emitToUser(notifyUserId, 'job_cancelled', { jobId: job._id, cancelledBy: role, reason: reasonText });
      const who = role === 'customer' ? 'The customer' : 'The artisan';
      notify(notifyUserId, 'job_cancelled',
        'Job Cancelled',
        `${who} has cancelled the ${job.category} job.${reasonText ? ` Reason: ${reasonText}` : ''}`,
        { jobId: job._id.toString() }
      );
      emailUser(notifyUserId, 'job_cancelled', {
        toRole: role === 'customer' ? 'artisan' : 'customer',
        cancelledBy: role, category: job.category, reason: reasonText,
      });
    }

    // A pending broadcast was cancelled: clear it from every notified artisan's dashboard
    if (job.status === 'pending' && job.notifiedArtisans?.length) {
      emitToUsers(job.notifiedArtisans, 'job_taken', { jobId: job._id });
      Notification.updateMany(
        { 'data.jobId': job._id.toString(), type: { $in: ['job_broadcast', 'new_job'] } },
        { $set: { dismissed: true } }
      ).catch(() => {});
    }

    // Repeated cancellations: automatic account warning (never blocks the cancel itself)
    try {
      const rule = WARN_RULES[role];
      if (policy.isLate) {
        const count = role === 'customer'
          ? await countCustomerLateCancels(req.user._id)
          : await countArtisanCancels(req.user._id);
        if (count >= rule.threshold && count % rule.threshold === 0) {
          const warnText = role === 'customer'
            ? `You have cancelled accepted jobs late ${count} times in the last ${rule.windowDays} days. Repeated late cancellations can lead to restrictions on your account.`
            : `You have cancelled ${count} accepted jobs in the last ${rule.windowDays} days. Customers rely on you showing up — repeated cancellations can lead to suspension.`;
          const warned = role === 'customer'
            ? await User.findByIdAndUpdate(req.user._id, { $inc: { warningCount: 1 } }, { new: true })
            : await ArtisanProfile.findOneAndUpdate({ userId: req.user._id }, { $inc: { warningCount: 1 } }, { new: true });
          notify(req.user._id, 'account_warning', `Account Warning #${warned?.warningCount ?? 1}`, warnText, {});
        }
      }
    } catch (warnErr) {
      console.error('cancelJob warning step failed (non-fatal):', warnErr.message);
    }

    res.status(200).json({
      success: true,
      message: policy.isLate && role === 'customer'
        ? 'Job cancelled. This was recorded as a late cancellation.'
        : 'Job cancelled.',
      data: { jobId: job._id, status: updated.status, isLate: !!policy.isLate },
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
    const isCustomer = job.customerId?._id?.toString() === userId;
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
    const { status, as: queryAs } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip  = (page - 1) * limit;

    // `as=customer` forces customer-side query regardless of current role,
    // allowing artisans who previously booked jobs to still see them.
    const actingAsCustomer = queryAs === 'customer' || req.user.role === 'customer';
    const query = actingAsCustomer
      ? { customerId: req.user._id }
      : { assignedArtisanId: req.user._id };

    if (status) query.status = status;

    const jobs = await Job.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customerId', 'name')
      .populate('assignedArtisanId', 'name')
      .select('-notifiedArtisans -declinedBy')
      .lean();

    const total = await Job.countDocuments(query);

    res.status(200).json({
      success: true,
      data: jobs,
      pagination: { page, limit, total },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch jobs.' });
  }
};
