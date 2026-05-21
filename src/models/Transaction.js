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

module.exports = mongoose.model('Transaction', transactionSchema);
