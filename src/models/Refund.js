const mongoose = require('mongoose');

const refundSchema = new mongoose.Schema(
  {
    transactionId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Transaction',
      required: true,
      index:    true,
    },

    refundReference: {
      type:   String,
      unique: true,
      sparse: true,   // null until provider assigns one
    },

    amount:   { type: Number, required: true },  // NGN
    reason:   { type: String, required: true },

    status: {
      type:    String,
      enum:    ['pending', 'success', 'failed'],
      default: 'pending',
    },

    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      required: true,
    },

    requestedAt:  { type: Date, default: Date.now },
    processedAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Refund', refundSchema);
