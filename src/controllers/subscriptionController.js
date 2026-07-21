'use strict';

const Subscription  = require('../models/Subscription');
const Transaction   = require('../models/Transaction');
const Refund        = require('../models/Refund');
const User          = require('../models/User');
const ArtisanProfile = require('../models/ArtisanProfile');
const korapay       = require('../services/korapayService');
const helper        = require('../helpers/subscriptionHelper');
const ENV           = require('../config/env');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BACKEND_URL = () => process.env.BACKEND_URL || 'https://fixngbackend-production.up.railway.app';

const makeTxRef = (artisanId) => `FIXNG_${artisanId}_${Date.now()}`;

const formatSub = (sub) => {
  if (!sub) return null;
  const now           = new Date();
  const msRemaining   = Math.max(0, new Date(sub.endsAt) - now);
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

  return {
    status:         sub.status,
    tier:           sub.tier,
    cycle:          sub.cycle,
    startsAt:       sub.startsAt,
    endsAt:         sub.endsAt,
    graceEndsAt:    sub.graceEndsAt,
    cancelledAt:    sub.cancelledAt,
    daysRemaining,
    isAllowed:      ['trial', 'active', 'grace'].includes(sub.status),
  };
};

// ─── GET /api/subscriptions/me ────────────────────────────────────────────────
exports.getMySubscription = async (req, res) => {
  try {
    const sub = await Subscription.findOne({ artisanId: req.user._id }).lean();
    // Return null when no subscription exists — artisan must explicitly subscribe.
    // Pro status is only granted via payment or admin action, never automatically.
    res.status(200).json({ success: true, data: sub ? formatSub(sub) : null });
  } catch (err) {
    console.error('getMySubscription error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch subscription.' });
  }
};

// ─── POST /api/subscriptions/initialize ──────────────────────────────────────
exports.initializeSubscription = async (req, res) => {
  const { cycle, redirectUrl: clientRedirectUrl } = req.body;

  if (!['monthly', 'quarterly', 'yearly'].includes(cycle)) {
    return res.status(400).json({ success: false, message: 'cycle must be monthly, quarterly, or yearly.' });
  }

  // Only verified artisans can subscribe
  const profile = await ArtisanProfile.findOne({ userId: req.user._id }).select('verificationStatus').lean();
  if (!profile || profile.verificationStatus !== 'verified') {
    return res.status(403).json({
      success: false,
      message: 'Your artisan account must be verified before subscribing.',
    });
  }

  const amountNGN = ENV.korapay.prices[cycle];
  const reference = makeTxRef(req.user._id.toString());

  const user  = await User.findById(req.user._id).select('email name phone').lean();
  // Use a reference-scoped email when no real email exists so each Kora Pay
  // charge has a unique customer email — prevents 409 "duplicate pending charge"
  // conflicts when the same phone-based email was used in a previous attempt.
  const email = user.email || `${reference.toLowerCase()}@fixng.app`;
  const name  = user.name || 'FixNG Artisan';

  const existingSub = await Subscription.findOne({ artisanId: req.user._id }).lean();
  const type = (!existingSub || existingSub.status === 'trial') ? 'subscription_purchase' : 'subscription_renewal';

  // Cancel any stale pending transactions — Kora Pay returns 409 if the same
  // customer email already has an active pending charge on their end.
  await Transaction.updateMany(
    { artisanId: req.user._id, status: 'pending' },
    { $set: { status: 'failed', failedAt: new Date(), providerResponse: { reason: 'superseded by new attempt' } } }
  );

  let tx;
  try {
    tx = await Transaction.create({
      reference,
      artisanId:     req.user._id,
      provider:      'korapay',
      type,
      cycle,
      amount:        amountNGN,
      currency:      'NGN',
      initializedAt: new Date(),
    });
  } catch (createErr) {
    // Partial unique index: a pending transaction already exists for this artisan
    // (concurrent double-tap). Tell the client to wait for the existing payment.
    if (createErr.code === 11000) {
      return res.status(429).json({
        success: false,
        message: 'A payment is already in progress. Please wait a moment and try again.',
      });
    }
    throw createErr;
  }

  try {
    const { checkout_url } = await korapay.initializeCharge({
      reference,
      amountNGN,
      email,
      name,
      cycle,
      artisanId:       req.user._id.toString(),
      notificationUrl: `${BACKEND_URL()}/api/webhooks/korapay`,
      redirectUrl:     clientRedirectUrl
        ? `${clientRedirectUrl}?reference=${reference}`
        : `fixng://subscription/callback?reference=${reference}`,
    });

    res.status(200).json({
      success: true,
      data: { checkout_url, reference, amount: amountNGN, cycle },
    });
  } catch (err) {
    const korapayStatus = err.korapayStatus || err.response?.status;
    const korapayBody   = err.korapayData   || err.response?.data;

    console.error('[initializeSubscription] Kora Pay HTTP status:', korapayStatus);
    console.error('[initializeSubscription] Kora Pay response body:', JSON.stringify(korapayBody));
    console.error('[initializeSubscription] err.message:', err.message);

    await Transaction.findByIdAndUpdate(tx._id, {
      status:           'failed',
      failedAt:         new Date(),
      providerResponse: { reason: err.message, korapayBody },
    });

    // AA021 = merchant daily pay-in limit exceeded
    if (korapayBody?.code === 'AA021') {
      return res.status(503).json({
        success: false,
        message: 'Payments are temporarily unavailable. Please try again later or contact support.',
      });
    }

    if (korapayStatus === 409) {
      return res.status(409).json({
        success: false,
        message: korapayBody?.message || 'A payment is already in progress. Please wait a moment and try again.',
      });
    }
    res.status(500).json({
      success: false,
      message: korapayBody?.message || 'Payment initialisation failed. Please try again.',
    });
  }
};

// ─── GET /api/subscriptions/verify/:reference ─────────────────────────────────
exports.verifySubscription = async (req, res) => {
  const { reference } = req.params;

  const tx = await Transaction.findOne({ reference }).lean();
  if (!tx) {
    return res.status(404).json({ success: false, message: 'Transaction not found.' });
  }

  // Idempotent — already terminal
  if (tx.status === 'success') {
    const sub = await Subscription.findOne({ artisanId: tx.artisanId }).lean();
    return res.status(200).json({ success: true, message: 'Subscription is active.', data: formatSub(sub) });
  }
  if (tx.status === 'failed') {
    return res.status(400).json({ success: false, message: 'This payment was not successful.' });
  }

  try {
    const charge = await korapay.verifyCharge(reference);

    const safe = { status: charge.status, amount: charge.amount, currency: charge.currency, reference: charge.reference };
    await Transaction.findByIdAndUpdate(tx._id, { providerResponse: safe });

    if (charge.status === 'success') {
      await helper.processSuccess(tx._id);
      const sub = await Subscription.findOne({ artisanId: tx.artisanId }).lean();
      return res.status(200).json({
        success: true,
        message: 'Subscription activated successfully! 🎉',
        data: formatSub(sub),
      });
    }

    await helper.processFailure(tx._id, `Kora Pay status: ${charge.status}`);
    return res.status(400).json({
      success: false,
      message: `Payment was not successful (status: ${charge.status}).`,
    });
  } catch (err) {
    console.error('verifySubscription error:', err.message);
    res.status(500).json({ success: false, message: 'Verification failed. Contact support if funds were deducted.' });
  }
};

// ─── POST /api/subscriptions/cancel ──────────────────────────────────────────
exports.cancelSubscription = async (req, res) => {
  try {
    const sub = await Subscription.findOne({ artisanId: req.user._id });
    if (!sub || sub.status === 'expired' || sub.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'No active subscription to cancel.' });
    }

    await Subscription.findByIdAndUpdate(sub._id, { cancelledAt: new Date(), status: 'cancelled' });

    res.status(200).json({
      success: true,
      message: 'Subscription cancelled. You can request a refund within 48 hours if eligible.',
    });
  } catch (err) {
    console.error('cancelSubscription error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel subscription.' });
  }
};

// ─── POST /api/subscriptions/refund ──────────────────────────────────────────
exports.requestRefund = async (req, res) => {
  const { transactionId, reason } = req.body;
  if (!transactionId || !reason?.trim()) {
    return res.status(400).json({ success: false, message: 'transactionId and reason are required.' });
  }

  try {
    const tx = await Transaction.findById(transactionId);
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found.' });

    const isAdmin = req.user.role === 'admin';
    const isOwner = tx.artisanId.toString() === req.user._id.toString();
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ success: false, message: 'Not authorised to refund this transaction.' });
    }

    if (tx.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Only successful transactions can be refunded.' });
    }

    const windowMs = ENV.sub.refundWindowHours * 60 * 60 * 1000;
    const elapsed  = Date.now() - new Date(tx.completedAt).getTime();
    if (elapsed > windowMs) {
      return res.status(400).json({
        success: false,
        message: `Refund window has closed (${ENV.sub.refundWindowHours}h limit).`,
      });
    }

    const sub       = await Subscription.findOne({ artisanId: tx.artisanId });
    const totalDays = helper.CYCLE_DAYS[tx.cycle] || 30;
    const remaining = sub ? Math.max(0, (new Date(sub.endsAt) - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
    const refundNGN = Math.round((remaining / totalDays) * tx.amount);

    if (refundNGN <= 0) {
      return res.status(400).json({ success: false, message: 'Subscription period has fully elapsed — no refundable amount.' });
    }

    const refundRecord = await Refund.create({
      transactionId: tx._id,
      amount:        refundNGN,
      reason:        reason.trim(),
      requestedBy:   req.user._id,
      requestedAt:   new Date(),
    });

    try {
      const result = await korapay.initiateRefund({ reference: tx.reference, amountNGN: refundNGN, reason: reason.trim() });
      await Refund.findByIdAndUpdate(refundRecord._id, { refundReference: result.reference || result.id });

      res.status(200).json({
        success: true,
        message: `Refund of ₦${refundNGN.toLocaleString('en-NG')} initiated. Expect 3–5 business days.`,
        data: { refundAmount: refundNGN, refundId: refundRecord._id },
      });
    } catch (providerErr) {
      await Refund.findByIdAndUpdate(refundRecord._id, { status: 'failed' });
      throw providerErr;
    }
  } catch (err) {
    console.error('requestRefund error:', err.message);
    res.status(500).json({ success: false, message: 'Refund initiation failed. Please try again or contact support.' });
  }
};

// ─── Flutterwave legacy (P-1) ─────────────────────────────────────────────────
// initiate → 410 Gone; webhook stays alive for 30-day catch window
exports.initiateSubscription = (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This payment method is no longer available. Please update the FixNG app.',
  });
};

exports.flutterwaveWebhook = async (req, res) => {
  if (req.headers['verif-hash'] !== process.env.FLW_WEBHOOK_HASH) return res.status(401).end();
  console.log('[flutterwaveWebhook] legacy event received:', req.body?.event);
  res.status(200).end();
};
