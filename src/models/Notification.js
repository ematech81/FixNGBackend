const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        // Job lifecycle
        'new_job',           // artisan: customer sent a direct job request
        'job_broadcast',     // artisan: new broadcast job in their area
        'job_accepted',      // customer: artisan accepted the job
        'job_declined',      // customer: artisan declined the job
        'artisan_arrived',   // customer: artisan has arrived
        'job_completed',     // customer: job marked complete, rate now
        'job_cancelled',     // either: job was cancelled by other party
        'dispute_raised',    // either: dispute was filed
        'dispute_resolved',  // either: admin resolved the dispute
        // Messaging
        'new_message',       // either: new chat message received
        // Account / system
        'profile_verified',
        'profile_rejected',
        'account_warning',
        'account_suspended',
        'account_unsuspended',
      ],
    },
    title: { type: String, required: true },
    body:  { type: String, required: true },
    // Payload for deep-linking (navigation on tap)
    data: {
      jobId:      { type: String, default: null },
      senderId:   { type: String, default: null },
      senderName: { type: String, default: null },
    },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// Index for efficient per-user queries sorted by newest first
notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
