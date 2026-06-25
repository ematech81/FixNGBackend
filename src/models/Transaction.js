const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    reference: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },

    artisanId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },

    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'Subscription',
    },

    provider: {
      type:    String,
      enum:    ['korapay', 'flutterwave'],
      default: 'korapay',
    },

    type: {
      type: String,
      enum: ['subscription_purchase', 'subscription_renewal'],
      required: true,
    },

    cycle: {
      type: String,
      enum: ['monthly', 'quarterly', 'yearly'],
      required: true,
    },

    amount:   { type: Number, required: true },  // NGN
    currency: { type: String, default: 'NGN' },

    status: {
      type:    String,
      enum:    ['pending', 'success', 'failed', 'refunded'],
      default: 'pending',
      index:   true,
    },

    // Last raw provider response — stripped of card data before storing
    providerResponse: { type: mongoose.Schema.Types.Mixed, default: null },

    initializedAt: { type: Date, default: Date.now },
    completedAt:   { type: Date, default: null },
    failedAt:      { type: Date, default: null },
  },
  { timestamps: true }
);

// Partial unique index — at most ONE pending transaction per artisan at any time.
// Prevents double-charge from concurrent POST /subscriptions/initialize requests:
// both requests mark old pending→failed (updateMany finds 0 records under a race),
// then both try to create; the second hits E11000 → controller returns 429.
// The constraint is automatically released once the transaction leaves 'pending'.
transactionSchema.index(
  { artisanId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'unique_pending_per_artisan',
  }
);

module.exports = mongoose.model('Transaction', transactionSchema);
