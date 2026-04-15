const mongoose = require('mongoose');
const PLANS    = require('../constants/subscriptionPlans');

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      unique:   true,  // one subscription record per user, updated in-place
      index:    true,
    },
    plan: {
      type:    String,
      enum:    Object.keys(PLANS),
      default: 'free',
    },
    status: {
      type:    String,
      enum:    ['active', 'cancelled', 'expired', 'past_due'],
      default: 'active',
    },
    startDate:  { type: Date, default: Date.now },
    expiresAt:  { type: Date, default: null },   // null = free plan (no expiry)

    // Paystack references
    paystackReference:       { type: String, default: null },
    paystackSubscriptionCode:{ type: String, default: null },
    paystackCustomerCode:    { type: String, default: null },

    autoRenew: { type: Boolean, default: true },

    // Payment history
    history: [
      {
        plan:      { type: String },
        amount:    { type: Number },
        currency:  { type: String, default: '₦' },
        reference: { type: String },
        paidAt:    { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Convenience: is the subscription currently paid and active?
subscriptionSchema.virtual('isPaid').get(function () {
  if (this.plan === 'free') return false;
  if (this.status !== 'active') return false;
  if (this.expiresAt && this.expiresAt < new Date()) return false;
  return true;
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
