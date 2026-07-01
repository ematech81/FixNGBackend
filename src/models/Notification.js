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
        'badge_upgraded',    // artisan: admin granted pro/trusted status
        'account_warning',
        'account_suspended',
        'account_unsuspended',
        // Admin broadcasts
        'announcement',      // admin: platform-wide or role-targeted announcement
      ],
    },
    title: { type: String, required: true },
    body:  { type: String, required: true },
    data: {
      jobId:      { type: String, default: null },
      senderId:   { type: String, default: null },
      senderName: { type: String, default: null },
    },
    read:      { type: Boolean, default: false, index: true },
    // pinned = shows as a persistent home-screen banner until dismissed
    pinned:    { type: Boolean, default: false, index: true },
    // dismissed = user manually closed the banner; never show it again
    dismissed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, pinned: 1, dismissed: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
