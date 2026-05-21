const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    artisanId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      unique:   true,
      index:    true,
    },

    status: {
      type:    String,
      enum:    ['trial', 'active', 'grace', 'expired', 'cancelled'],
      default: 'trial',
    },

    tier: {
      type:    String,
      enum:    ['pro'],
      default: 'pro',
    },

    cycle: {
      type:    String,
      enum:    ['monthly', 'quarterly', 'yearly', 'trial'],
      default: 'trial',
    },

    startsAt:  { type: Date, required: true },
    endsAt:    { type: Date, required: true },
    graceEndsAt: { type: Date, default: null },

    cancelledAt: { type: Date, default: null },

    currentTransactionId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Transaction',
      default: null,
    },
  },
  { timestamps: true }
);

// Convenience: is this subscription currently allowing artisan access?
subscriptionSchema.virtual('isAllowed').get(function () {
  return ['trial', 'active', 'grace'].includes(this.status);
});

// Days remaining until endsAt (0 if already past)
subscriptionSchema.virtual('daysRemaining').get(function () {
  const diff = this.endsAt - new Date();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
