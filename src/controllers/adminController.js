const User = require('../models/User');
const ArtisanProfile = require('../models/ArtisanProfile');
const Job = require('../models/Job');
const Complaint = require('../models/Complaint');
const Review = require('../models/Review');
const { emitToUser } = require('../socket');
const { notify } = require('./notificationController');

// ─── GET /api/admin/users — List all users with filters ──────────────────────
exports.getUsers = async (req, res) => {
  try {
    const { role, page = 1, limit = 30, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (role) query.role = role;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-password')
      .lean();

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: users,
      pagination: { page: parseInt(page), limit: parseInt(limit), total },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
};

// ─── GET /api/admin/artisans — List artisans with verification status filter ──
exports.getArtisans = async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (status) query.verificationStatus = status;

    const profiles = await ArtisanProfile.find(query)
      .populate('userId', 'name phone email createdAt isActive')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await ArtisanProfile.countDocuments(query);

    const data = profiles.map((p) => ({
      artisanProfileId: p._id,
      userId: p.userId?._id,
      name: p.userId?.name,
      phone: p.userId?.phone,
      email: p.userId?.email,
      verificationStatus: p.verificationStatus,
      badgeLevel: p.badgeLevel,
      isSuspended: p.isSuspended,
      isBanned: p.isBanned,
      warningCount: p.warningCount,
      onboardingComplete: p.onboardingComplete,
      stats: p.stats,
      skills: p.skills,
      joinedAt: p.userId?.createdAt,
    }));

    res.status(200).json({
      success: true,
      data,
      pagination: { page: parseInt(page), limit: parseInt(limit), total },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch artisans.' });
  }
};

// ─── GET /api/admin/artisans/:artisanUserId — Full artisan profile for admin ──
exports.getArtisanDetail = async (req, res) => {
  try {
    const profile = await ArtisanProfile.findOne({ userId: req.params.artisanUserId })
      .populate('userId', 'name phone email createdAt isActive')
      .lean();

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Artisan not found.' });
    }

    res.status(200).json({ success: true, data: profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch artisan.' });
  }
};

// ─── POST /api/admin/artisans/:artisanUserId/verify — Verify artisan ──────────
exports.verifyArtisan = async (req, res) => {
  try {
    const profile = await ArtisanProfile.findOne({ userId: req.params.artisanUserId });
    if (!profile) return res.status(404).json({ success: false, message: 'Artisan not found.' });

    profile.verificationStatus = 'verified';
    profile.rejectionReason = null;
    profile.reviewedAt = new Date();
    await profile.save();

    emitToUser(req.params.artisanUserId, 'profile_verified', {
      message: 'Your profile has been verified! You can now receive job requests.',
    });
    notify(req.params.artisanUserId, 'profile_verified',
      'Profile Verified',
      'Congratulations! Your profile has been verified. You can now receive job requests.',
      {}
    );

    res.status(200).json({ success: true, message: 'Artisan verified.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to verify artisan.' });
  }
};

// ─── POST /api/admin/artisans/:artisanUserId/reject — Reject artisan ──────────
exports.rejectArtisan = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
    }

    const profile = await ArtisanProfile.findOne({ userId: req.params.artisanUserId });
    if (!profile) return res.status(404).json({ success: false, message: 'Artisan not found.' });

    profile.verificationStatus = 'rejected';
    profile.rejectionReason = reason.trim();
    profile.reviewedAt = new Date();
    await profile.save();

    emitToUser(req.params.artisanUserId, 'profile_rejected', {
      reason: profile.rejectionReason,
      message: 'Your profile was not approved. Please review the feedback and resubmit.',
    });
    notify(req.params.artisanUserId, 'profile_rejected',
      'Profile Verification Rejected',
      `Your profile was not approved. Reason: ${profile.rejectionReason}`,
      {}
    );

    res.status(200).json({ success: true, message: 'Artisan rejected.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to reject artisan.' });
  }
};

// ─── POST /api/admin/artisans/:artisanUserId/warn ─────────────────────────────
exports.warnArtisan = async (req, res) => { 
  try {
    const { reason } = req.body;

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'Warning reason is required.' });
    }
 
    const profile = await ArtisanProfile.findOneAndUpdate(
      { userId: req.params.artisanUserId },
      { $inc: { warningCount: 1 } },
      { new: true }
    );

    if (!profile) return res.status(404).json({ success: false, message: 'Artisan not found.' });

    emitToUser(req.params.artisanUserId, 'account_warning', {
      reason: reason.trim(),
      warningCount: profile.warningCount,
      message: `Warning #${profile.warningCount}: ${reason.trim()}`,
    });
    notify(req.params.artisanUserId, 'account_warning',
      `Account Warning #${profile.warningCount}`,
      reason.trim(),
      {}
    );

    res.status(200).json({
      success: true,
      message: 'Warning issued.',
      data: { warningCount: profile.warningCount },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to warn artisan.' });
  }
}; 
 
// ─── POST /api/admin/artisans/:artisanUserId/suspend ──────────────────────────
exports.suspendArtisan = async (req, res) => {
  try {
    const { reason } = req.body;  
 
    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'Suspension reason is required.' });
    }
 
    const profile = await ArtisanProfile.findOneAndUpdate(
      { userId: req.params.artisanUserId },
      { isSuspended: true, suspensionReason: reason.trim() },
      { new: true }
    );

    if (!profile) return res.status(404).json({ success: false, message: 'Artisan not found.' });

    emitToUser(req.params.artisanUserId, 'account_suspended', {
      reason: reason.trim(),
      message: 'Your account has been suspended. Contact support to appeal.',
    });
    notify(req.params.artisanUserId, 'account_suspended',
      'Account Suspended',
      `Your account has been suspended. Reason: ${reason.trim()}`,
      {}
    );

    res.status(200).json({ success: true, message: 'Artisan suspended.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to suspend artisan.' });
  }
};

// ─── POST /api/admin/artisans/:artisanUserId/unsuspend ────────────────────────
exports.unsuspendArtisan = async (req, res) => {
  try {
    await ArtisanProfile.findOneAndUpdate(
      { userId: req.params.artisanUserId },
      { isSuspended: false, suspensionReason: null }
    );

    emitToUser(req.params.artisanUserId, 'account_unsuspended', {
      message: 'Your suspension has been lifted. You can now receive jobs again.',
    });
    notify(req.params.artisanUserId, 'account_unsuspended',
      'Suspension Lifted',
      'Your account suspension has been lifted. You can now receive job requests again.',
      {}
    );

    res.status(200).json({ success: true, message: 'Artisan unsuspended.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to unsuspend.' });
  }
};

// ─── POST /api/admin/artisans/:artisanUserId/ban ──────────────────────────────
exports.banArtisan = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'Ban reason is required.' });
    }

    const profile = await ArtisanProfile.findOneAndUpdate(
      { userId: req.params.artisanUserId },
      { isBanned: true, banReason: reason.trim(), isSuspended: false },
      { new: true }
    );

    if (!profile) return res.status(404).json({ success: false, message: 'Artisan not found.' });

    // Deactivate user account entirely
    await User.findByIdAndUpdate(req.params.artisanUserId, { isActive: false });

    res.status(200).json({ success: true, message: 'Artisan banned and account deactivated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to ban artisan.' });
  }
};

// ─── GET /api/admin/jobs — View all jobs ─────────────────────────────────────
exports.getJobs = async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (status) query.status = status;

    const jobs = await Job.find(query)
      .populate('customerId', 'name phone')
      .populate('assignedArtisanId', 'name phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
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

// ─── GET /api/admin/complaints — View all complaints ─────────────────────────
exports.getComplaints = async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (status) query.status = status;

    const complaints = await Complaint.find(query)
      .populate('submittedBy', 'name phone role')
      .populate('againstUserId', 'name phone role')
      .populate('jobId', 'category status createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Complaint.countDocuments(query);

    res.status(200).json({
      success: true,
      data: complaints,
      pagination: { page: parseInt(page), limit: parseInt(limit), total },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch complaints.' });
  }
};

// ─── POST /api/admin/complaints/:complaintId/resolve ──────────────────────────
exports.resolveComplaint = async (req, res) => {
  try {
    const { resolution, status } = req.body;

    const validStatuses = ['resolved', 'dismissed', 'under_review'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const complaint = await Complaint.findByIdAndUpdate(
      req.params.complaintId,
      {
        status: status || 'resolved',
        resolution: resolution?.trim() || null,
        resolvedBy: req.user._id,
        resolvedAt: new Date(),
      },
      { new: true }
    );

    if (!complaint) return res.status(404).json({ success: false, message: 'Complaint not found.' });

    res.status(200).json({ success: true, message: 'Complaint updated.', data: complaint });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update complaint.' });
  }
};

// ─── POST /api/admin/jobs/:jobId/resolve-dispute ─────────────────────────────
exports.resolveDispute = async (req, res) => {
  try {
    const { resolution } = req.body;

    if (!resolution?.trim()) {
      return res.status(400).json({ success: false, message: 'Resolution is required.' });
    }

    const job = await Job.findById(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });

    if (job.status !== 'disputed') {
      return res.status(400).json({ success: false, message: 'Job is not in disputed state.' });
    }

    job.dispute.resolution = resolution.trim();
    job.dispute.resolvedAt = new Date();
    job.dispute.resolvedBy = req.user._id;
    job.status = 'completed';
    await job.save();

    // Notify both parties
    const notifyIds = [job.customerId.toString()];
    if (job.assignedArtisanId) notifyIds.push(job.assignedArtisanId.toString());

    notifyIds.forEach((id) => {
      emitToUser(id, 'dispute_resolved', {
        jobId: job._id,
        resolution: resolution.trim(),
        message: 'The admin has resolved your dispute.',
      });
      notify(id, 'dispute_resolved',
        'Dispute Resolved',
        `Your dispute has been resolved. Resolution: ${resolution.trim()}`,
        { jobId: job._id.toString() }
      );
    });

    res.status(200).json({ success: true, message: 'Dispute resolved.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to resolve dispute.' });
  }
};

// ─── GET /api/admin/users/list — Paginated user list with role filter ─────────
// Distinct from /api/admin/users so it can include artisan isPro info
exports.listUsers = async (req, res) => {
  try {
    const { role, page = 1, limit = 50, isPro } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const userQuery = {};
    if (role === 'customer') userQuery.role = 'customer';
    if (role && role !== 'customer') userQuery.role = role;

    const users = await User.find(userQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-password')
      .lean();

    const total = await User.countDocuments(userQuery);

    // For artisans, attach profile info (skills, verificationStatus, isPro)
    let result = users;
    if (role === 'artisan' || !role) {
      const artisanIds = users.filter((u) => u.role === 'artisan').map((u) => u._id);
      const profiles = await ArtisanProfile.find({ userId: { $in: artisanIds } })
        .select('userId skills verificationStatus badgeLevel isPro proSource isSuspended')
        .lean();
      const profileMap = {};
      profiles.forEach((p) => { profileMap[p.userId.toString()] = p; });

      result = users.map((u) => {
        const profile = profileMap[u._id.toString()];
        return {
          ...u,
          skills: profile?.skills || [],
          verificationStatus: profile?.verificationStatus || null,
          badgeLevel: profile?.badgeLevel || null,
          isPro: profile?.isPro || false,
          proSource: profile?.proSource || null,
          isSuspended: profile?.isSuspended || false,
        };
      });

      // Filter by isPro if requested
      if (isPro === 'true') {
        result = result.filter((u) => u.isPro);
      }
    }

    res.status(200).json({
      success: true,
      data: result,
      pagination: { page: parseInt(page), limit: parseInt(limit), total },
    });
  } catch (err) {
    console.error('listUsers error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
};

// ─── POST /api/admin/users/:userId/toggle-active — Enable / disable a user ────
exports.toggleUserActive = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    // Prevent admin from disabling themselves
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot disable your own account.' });
    }

    user.isActive = !user.isActive;
    await user.save();

    const action = user.isActive ? 'enabled' : 'disabled';
    res.status(200).json({
      success: true,
      message: `User account ${action}.`,
      data: { isActive: user.isActive },
    });
  } catch (err) {
    console.error('toggleUserActive error:', err);
    res.status(500).json({ success: false, message: 'Failed to update user status.' });
  }
};

// ─── POST /api/admin/artisans/:artisanUserId/grant-pro ────────────────────────
// Admin manually grants Pro status to an artisan (bypasses subscription)
exports.grantPro = async (req, res) => {
  try {
    const profile = await ArtisanProfile.findOneAndUpdate(
      { userId: req.params.artisanUserId },
      {
        isPro: true,
        proSource: 'admin',
        proGrantedBy: req.user._id,
        proGrantedAt: new Date(),
      },
      { new: true }
    );

    if (!profile) return res.status(404).json({ success: false, message: 'Artisan not found.' });

    notify(req.params.artisanUserId, 'profile_verified',
      'You\'re now a Pro! ⭐',
      'Congratulations! You have been granted Pro status on FixNG. Your profile now appears first in search results.',
      {}
    );

    res.status(200).json({ success: true, message: 'Pro status granted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to grant Pro status.' });
  }
};

// ─── POST /api/admin/artisans/:artisanUserId/revoke-pro ───────────────────────
// Admin revokes Pro status (works for both subscription and admin grants)
exports.revokePro = async (req, res) => {
  try {
    const profile = await ArtisanProfile.findOneAndUpdate(
      { userId: req.params.artisanUserId },
      { isPro: false, proSource: null, proGrantedBy: null, proGrantedAt: null },
      { new: true }
    );

    if (!profile) return res.status(404).json({ success: false, message: 'Artisan not found.' });

    notify(req.params.artisanUserId, 'account_warning',
      'Pro Status Removed',
      'Your Pro status on FixNG has been removed.',
      {}
    );

    res.status(200).json({ success: true, message: 'Pro status revoked.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to revoke Pro status.' });
  }
};

// ─── Customer moderation ──────────────────────────────────────────────────────

exports.warnCustomer = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ success: false, message: 'Warning reason is required.' });
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { $inc: { warningCount: 1 } },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, message: 'Customer not found.' });
    notify(req.params.userId, 'account_warning',
      `Account Warning #${user.warningCount}`,
      reason.trim(), {}
    );
    res.status(200).json({ success: true, message: 'Warning issued.', data: { warningCount: user.warningCount } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to warn customer.' });
  }
};

exports.suspendCustomer = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ success: false, message: 'Suspension reason is required.' });
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { isSuspended: true, suspensionReason: reason.trim() },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, message: 'Customer not found.' });
    notify(req.params.userId, 'account_suspended',
      'Account Suspended',
      reason.trim(), {}
    );
    res.status(200).json({ success: true, message: 'Customer suspended.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to suspend customer.' });
  }
};

exports.unsuspendCustomer = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { isSuspended: false, suspensionReason: null },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, message: 'Customer not found.' });
    notify(req.params.userId, 'account_unsuspended',
      'Account Reinstated',
      'Your account has been reinstated. You can now use FixNG again.', {}
    );
    res.status(200).json({ success: true, message: 'Customer unsuspended.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to unsuspend customer.' });
  }
};

// ─── GET /api/admin/stats — Dashboard overview ────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const [
      totalUsers,
      totalArtisans,
      pendingVerifications,
      totalJobs,
      activeJobs,
      openComplaints,
    ] = await Promise.all([
      User.countDocuments({ role: { $in: ['customer', 'artisan'] } }),
      ArtisanProfile.countDocuments({ verificationStatus: 'verified' }),
      ArtisanProfile.countDocuments({ verificationStatus: 'pending' }),
      Job.countDocuments(),
      Job.countDocuments({ status: { $in: ['pending', 'accepted', 'in-progress'] } }),
      Complaint.countDocuments({ status: 'open' }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalVerifiedArtisans: totalArtisans,
        pendingVerifications,
        totalJobs,
        activeJobs,
        openComplaints,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch stats.' });
  }
};
