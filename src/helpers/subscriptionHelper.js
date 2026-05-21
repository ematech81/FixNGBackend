'use strict';

const mongoose    = require('mongoose');
const Subscription = require('../models/Subscription');
const Transaction  = require('../models/Transaction');
const Refund       = require('../models/Refund');
const ArtisanProfile = require('../models/ArtisanProfile');
const { notify }  = require('../controllers/notificationController');
const ENV         = require('../config/env');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CYCLE_DAYS = { monthly: 30, quarterly: 91, yearly: 365 };

const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

const syncProStatus = async (artisanId, active) => {
  try {
    if (active) {
      await ArtisanProfile.findOneAndUpdate(
        { userId: artisanId },
        { isPro: true, proSource: 'subscription', proGrantedAt: new Date() }
      );
    } else {
      await ArtisanProfile.findOneAndUpdate(
        { userId: artisanId, proSource: 'subscription' },
        { isPro: false, proSource: null, proGrantedAt: null, proGrantedBy: null }
      );
    }
  } catch (e) {
    console.warn('[subscriptionHelper] syncProStatus non-fatal:', e.message);
  }
};

// ─── startTrial ───────────────────────────────────────────────────────────────
/**
 * Called immediately after a new artisan account is created.
 * Idempotent — safe to call twice (e.g., becomeArtisan retry).
 */
const startTrial = async (artisanId) => {
  const existing = await Subscription.findOne({ artisanId });
  if (existing) return existing;

  const now = new Date();
  const sub = await Subscription.create({
    artisanId,
    status:    'trial',
    tier:      'pro',
    cycle:     'trial',
    startsAt:  now,
    endsAt:    daysFromNow(ENV.sub.trialDays),
    graceEndsAt: daysFromNow(ENV.sub.trialDays),
  });

  await syncProStatus(artisanId, true);
  return sub;
};

// ─── processSuccess ───────────────────────────────────────────────────────────
/**
 * Extend subscription on a successful payment.
 * Idempotent — replayed webhooks / double-calls are safe.
 */
const processSuccess = async (transactionId) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const tx = await Transaction.findById(transactionId).session(session);
      if (!tx) throw new Error(`Transaction ${transactionId} not found`);
      if (tx.status === 'success') return; // already processed — exit early

      const now  = new Date();
      const days = CYCLE_DAYS[tx.cycle] || 30;

      // Extend from current endsAt if still in future, else from now
      let sub = await Subscription.findOne({ artisanId: tx.artisanId }).session(session);
      const base   = (sub && sub.endsAt > now) ? sub.endsAt : now;
      const endsAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
      const graceEndsAt = new Date(endsAt.getTime() + ENV.sub.graceDays * 24 * 60 * 60 * 1000);

      sub = await Subscription.findOneAndUpdate(
        { artisanId: tx.artisanId },
        {
          status:               'active',
          tier:                 'pro',
          cycle:                tx.cycle,
          startsAt:             sub?.startsAt || now,
          endsAt,
          graceEndsAt,
          cancelledAt:          null,
          currentTransactionId: tx._id,
        },
        { upsert: true, new: true, session }
      );

      await Transaction.findByIdAndUpdate(
        tx._id,
        {
          status:           'success',
          completedAt:      now,
          subscriptionId:   sub._id,
        },
        { session }
      );
    });

    // Sync pro status outside transaction (non-critical, non-atomic)
    const tx = await Transaction.findById(transactionId);
    await syncProStatus(tx.artisanId, true);

  } finally {
    await session.endSession();
  }
};

// ─── processFailure ───────────────────────────────────────────────────────────
/**
 * Mark a transaction as failed. Subscription state is unchanged.
 * Idempotent.
 */
const processFailure = async (transactionId, reason) => {
  const tx = await Transaction.findById(transactionId);
  if (!tx || tx.status !== 'pending') return;

  await Transaction.findByIdAndUpdate(transactionId, {
    status:           'failed',
    failedAt:         new Date(),
    providerResponse: { reason },
  });
};

// ─── processRefund ────────────────────────────────────────────────────────────
/**
 * Called when Kora Pay fires refund.success.
 * Reverts subscription endsAt by the refunded proportion.
 * Idempotent.
 */
const processRefund = async (refundReference) => {
  const refundRecord = await Refund.findOne({ refundReference });
  if (!refundRecord || refundRecord.status === 'success') return;

  const tx = await Transaction.findById(refundRecord.transactionId);
  if (!tx || tx.status === 'refunded') return;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const days        = CYCLE_DAYS[tx.cycle] || 30;
      const refundRatio = refundRecord.amount / tx.amount;
      const refundDays  = Math.floor(days * refundRatio);

      const sub = await Subscription.findOne({ artisanId: tx.artisanId }).session(session);
      if (sub) {
        const now        = new Date();
        const newEndsAt  = new Date(sub.endsAt.getTime() - refundDays * 24 * 60 * 60 * 1000);
        const newGraceAt = new Date(newEndsAt.getTime() + ENV.sub.graceDays * 24 * 60 * 60 * 1000);

        if (newEndsAt < now) {
          await Subscription.findByIdAndUpdate(sub._id, {
            status: 'expired', endsAt: newEndsAt, graceEndsAt: newGraceAt,
          }, { session });
        } else {
          await Subscription.findByIdAndUpdate(sub._id, {
            endsAt: newEndsAt, graceEndsAt: newGraceAt,
          }, { session });
        }
      }

      await Transaction.findByIdAndUpdate(tx._id, { status: 'refunded' }, { session });
      await Refund.findByIdAndUpdate(refundRecord._id, {
        status: 'success', processedAt: new Date(),
      }, { session });
    });

    const tx2 = await Transaction.findById(refundRecord.transactionId);
    const sub  = await Subscription.findOne({ artisanId: tx2.artisanId });
    if (sub?.status === 'expired') await syncProStatus(tx2.artisanId, false);

  } finally {
    await session.endSession();
  }
};

module.exports = { startTrial, processSuccess, processFailure, processRefund, syncProStatus, CYCLE_DAYS };
