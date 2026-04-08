const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema(
  {
    // ── Parties ──────────────────────────────────────────────────────────────
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    assignedArtisanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ── Job Details ───────────────────────────────────────────────────────────
    category: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: [1000, 'Description too long.'],
    },
    images: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
      },
    ],
    urgency: {
      type: String,
      enum: ['normal', 'emergency'],
      default: 'normal',
    },

    // ── Location (where the job is) ───────────────────────────────────────────
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
      address: { type: String, default: null },
      state: { type: String, default: null },
      lga: { type: String, default: null },
    },

    // ── Status lifecycle: pending → accepted → in-progress → completed / disputed ──
    status: {
      type: String,
      enum: ['pending', 'accepted', 'in-progress', 'completed', 'disputed', 'cancelled'],
      default: 'pending',
    },

    // ── Artisan engagement tracking ───────────────────────────────────────────
    // Artisans who received the push notification
    notifiedArtisans: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Artisans who explicitly declined
    declinedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // ── Timeline (each status transition recorded) ────────────────────────────
    timeline: {
      acceptedAt: { type: Date, default: null },
      artisanArrivedAt: { type: Date, default: null },  // artisan marks arrival
      startedAt: { type: Date, default: null },          // job work begins
      completedAt: { type: Date, default: null },
      disputedAt: { type: Date, default: null },
      cancelledAt: { type: Date, default: null },
    },

    // ── Arrival tracking ──────────────────────────────────────────────────────
    // Artisan's estimated arrival (set when accepting)
    estimatedArrivalMinutes: { type: Number, default: null },
    // Whether artisan arrived on time (set after arrival marked)
    arrivedOnTime: { type: Boolean, default: null },

    // ── Dispute ───────────────────────────────────────────────────────────────
    dispute: {
      raisedBy: { type: String, enum: ['customer', 'artisan'], default: null },
      reason: { type: String, default: null },
      resolution: { type: String, default: null },
      resolvedAt: { type: Date, default: null },
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // admin
    },

    // ── Payment (escrow — integrated in payment feature) ──────────────────────
    agreedPrice: { type: Number, default: null },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'escrowed', 'released', 'refunded'],
      default: 'unpaid',
    },

    // ── Rating (filled after completion) ─────────────────────────────────────
    rating: {
      score: { type: Number, min: 1, max: 5, default: null },
      review: { type: String, default: null },
      ratedAt: { type: Date, default: null },
    },

    // ── Cancellation ──────────────────────────────────────────────────────────
    cancellation: {
      cancelledBy: { type: String, enum: ['customer', 'artisan', 'admin'], default: null },
      reason: { type: String, default: null },
    },

    // Emergency jobs expire faster if no artisan accepts
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Geo index for finding jobs near artisan
JobSchema.index({ location: '2dsphere' });

// Index for fast status queries
JobSchema.index({ status: 1, createdAt: -1 });
JobSchema.index({ customerId: 1, status: 1 });
JobSchema.index({ assignedArtisanId: 1, status: 1 });

module.exports = mongoose.model('Job', JobSchema);
