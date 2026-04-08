const mongoose = require('mongoose');

// Separate from Job.dispute — complaints are post-job reports submitted to admin
const ComplaintSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    againstUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: [1000, 'Complaint reason must be 1000 characters or less.'],
    },
    // Admin review status
    status: {
      type: String,
      enum: ['open', 'under_review', 'resolved', 'dismissed'],
      default: 'open',
    },
    // Admin resolution notes
    resolution: {
      type: String,
      default: null,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

ComplaintSchema.index({ againstUserId: 1, status: 1 });
ComplaintSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Complaint', ComplaintSchema);
