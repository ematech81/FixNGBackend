const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
      unique: true, // one review per job
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    artisanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Guide requires rating on three dimensions
    ratings: {
      quality: { type: Number, min: 1, max: 5, required: true },
      timeliness: { type: Number, min: 1, max: 5, required: true },
      communication: { type: Number, min: 1, max: 5, required: true },
    },

    // Computed overall score (average of the three)
    overallScore: { type: Number, min: 1, max: 5, required: true },

    comment: {
      type: String,
      default: null,
      maxlength: [500, 'Review comment must be 500 characters or less.'],
      trim: true,
    },
  },
  { timestamps: true }
);

ReviewSchema.index({ artisanId: 1, createdAt: -1 });

module.exports = mongoose.model('Review', ReviewSchema);
