const mongoose = require('mongoose');

const ArtisanProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    // Step 1 — Profile Photo
    profilePhoto: {
      url: { type: String, default: null },
      publicId: { type: String, default: null }, // cloudinary public_id for deletion
    },

    // Step 2 — Skills
    skills: {
      type: [String],
      default: [],
    },

    // Step 3 — Location (GeoJSON Point)
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
      address: { type: String, default: null },
      state: { type: String, default: null },
      lga: { type: String, default: null }, // Local Government Area
    },

    // Step 4 — Verification ID
    verificationId: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
      idType: {
        type: String,
        enum: ['NIN', 'Voters Card', "Driver's License", 'International Passport', 'BVN'],
        // No default — leaving undefined so enum validation is skipped until a value is set
      },
      uploadedAt: { type: Date, default: null },
    },

    // Bio — short description the artisan writes about themselves
    bio: {
      type: String,
      default: null,
      maxlength: [300, 'Bio must be 300 characters or less.'],
      trim: true,
    },

    // Step 5 — Skill Video
    skillVideo: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
      uploadedAt: { type: Date, default: null },
    },

    // Tracks which onboarding steps have been completed
    // Artisan can resume from where they stopped (unreliable internet in Nigeria)
    completedSteps: {
      profilePhoto: { type: Boolean, default: false },
      skills: { type: Boolean, default: false },
      location: { type: Boolean, default: false },
      verificationId: { type: Boolean, default: false },
      skillVideo: { type: Boolean, default: false },
    },

    onboardingComplete: {
      type: Boolean,
      default: false,
    },

    // Verification status — artisan CANNOT receive jobs until 'verified'
    verificationStatus: {
      type: String,
      enum: ['incomplete', 'pending', 'verified', 'rejected'],
      default: 'incomplete',
    },

    // Admin fills this on rejection so artisan knows why
    rejectionReason: {
      type: String,
      default: null,
    },

    // Date admin last reviewed this profile
    reviewedAt: {
      type: Date,
      default: null,
    },

    // Badge level — trust tier visible on profile
    // new: 0-5 jobs | verified: verified but <10 jobs | trusted: 10+ jobs + good ratings
    badgeLevel: {
      type: String,
      enum: ['new', 'verified', 'trusted'],
      default: 'new',
    },

    // Admin actions
    warningCount: { type: Number, default: 0 },
    isSuspended: { type: Boolean, default: false },
    suspensionReason: { type: String, default: null },
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: null },

    // Performance metrics — populated as jobs are completed
    stats: {
      totalJobs: { type: Number, default: 0 },
      completedJobs: { type: Number, default: 0 },
      cancelledJobs: { type: Number, default: 0 },
      disputeCount: { type: Number, default: 0 },
      averageRating: { type: Number, default: 0 },
      totalRatings: { type: Number, default: 0 },
      onTimeArrivalRate: { type: Number, default: 0 }, // percentage
      acceptanceRate: { type: Number, default: 0 },    // % of job requests accepted
      avgResponseTimeMinutes: { type: Number, default: null }, // avg mins to accept/decline
    },
  },
  { timestamps: true }
);

// 2dsphere index for geo-based artisan discovery
ArtisanProfileSchema.index({ location: '2dsphere' });

// Virtual: check if all 5 steps are done
ArtisanProfileSchema.virtual('allStepsDone').get(function () {
  const s = this.completedSteps;
  return s.profilePhoto && s.skills && s.location && s.verificationId && s.skillVideo;
});

// Before saving, auto-set onboardingComplete, status, and badgeLevel
ArtisanProfileSchema.pre('save', function (next) {
  const s = this.completedSteps;
  const allDone = s.profilePhoto && s.skills && s.location && s.verificationId && s.skillVideo;

  if (allDone && !this.onboardingComplete) {
    this.onboardingComplete = true;
    // Only move to pending if currently incomplete (don't override verified/rejected)
    if (this.verificationStatus === 'incomplete') {
      this.verificationStatus = 'pending';
    }
  }

  // Auto-compute badge level
  if (this.verificationStatus === 'verified') {
    const completed = this.stats.completedJobs;
    const avgRating = this.stats.averageRating;
    if (completed >= 10 && avgRating >= 4.0 && this.stats.disputeCount === 0) {
      this.badgeLevel = 'trusted';
    } else if (completed >= 10 && avgRating >= 3.5) {
      this.badgeLevel = 'trusted';
    } else {
      this.badgeLevel = 'verified';
    }
  } else {
    this.badgeLevel = 'new';
  }

  next();
});

module.exports = mongoose.model('ArtisanProfile', ArtisanProfileSchema);
