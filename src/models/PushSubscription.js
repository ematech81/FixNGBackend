const mongoose = require('mongoose');

// One row per browser/device that opted in to web push. `endpoint` is unique per
// browser install, so re-subscribing (or another user logging in on the same
// browser) updates the owner instead of duplicating.
const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth:   { type: String, required: true },
    },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
