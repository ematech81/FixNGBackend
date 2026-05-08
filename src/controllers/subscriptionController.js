const Subscription   = require('../models/Subscription');
const ArtisanProfile = require('../models/ArtisanProfile');
const User           = require('../models/User');
const PLANS          = require('../constants/subscriptionPlans');
const { initializePayment, verifyPayment } = require('../services/flutterwaveService');
const { notify } = require('./notificationController');

// ─── Helper: keep ArtisanProfile.isPro in sync ───────────────────────────────
const syncProStatus = async (userId, active, source = 'subscription') => {
  try {
    if (active) {
      await ArtisanProfile.findOneAndUpdate(
        { userId },
        { isPro: true, proSource: source, proGrantedAt: new Date() },
        { new: true }
      );
    } else {
      await ArtisanProfile.findOneAndUpdate(
        { userId, proSource: 'subscription' },
        { isPro: false, proSource: null, proGrantedAt: null, proGrantedBy: null }
      );
    }
  } catch (e) {
    console.warn('syncProStatus failed (non-fatal):', e.message);
  }
};

// ─── Helper: activate subscription record ────────────────────────────────────
const activateSubscription = async (userId, plan, txRef) => {
  const now      = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await Subscription.findOneAndUpdate(
    { userId },
    {
      plan:             plan.id,
      status:           'active',
      startDate:        now,
      expiresAt,
      paymentReference: txRef,
      autoRenew:        true,
      $push: {
        history: {
          plan:      plan.id,
          amount:    plan.price,
          currency:  '₦',
          reference: txRef,
          paidAt:    now,
        },
      },
    },
    { upsert: true, new: true }
  );

  await syncProStatus(userId, true, 'subscription');
};

// ─── GET /api/subscriptions/plans ────────────────────────────────────────────
exports.getPlans = (req, res) => {
  res.status(200).json({ success: true, data: Object.values(PLANS) });
};

// ─── GET /api/subscriptions/me ───────────────────────────────────────────────
exports.getMySubscription = async (req, res) => {
  try {
    let sub = await Subscription.findOne({ userId: req.user._id }).lean();

    if (!sub) {
      sub = await Subscription.create({ userId: req.user._id, plan: 'free' });
      sub = sub.toObject();
    }

    // Auto-expire lapsed paid plans
    if (sub.plan !== 'free' && sub.expiresAt && new Date(sub.expiresAt) < new Date()) {
      await Subscription.findOneAndUpdate(
        { userId: req.user._id },
        { status: 'expired', plan: 'free' }
      );
      await syncProStatus(req.user._id, false);
      sub.status = 'expired';
      sub.plan   = 'free';
    }

    const planDetails = PLANS[sub.plan] || PLANS.free;
    res.status(200).json({ success: true, data: { ...sub, planDetails } });
  } catch (err) {
    console.error('getMySubscription error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch subscription.' });
  }
};

// ─── POST /api/subscriptions/initiate ────────────────────────────────────────
exports.initiateSubscription = async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = PLANS[planId];

    if (!plan || plan.id === 'free') {
      return res.status(400).json({ success: false, message: 'Invalid plan selected.' });
    }

    // Only verified artisans can subscribe
    const artisanProfile = await ArtisanProfile.findOne({ userId: req.user._id })
      .select('verificationStatus').lean();
    if (!artisanProfile || artisanProfile.verificationStatus !== 'verified') {
      return res.status(403).json({
        success: false,
        message: 'Your artisan account must be verified before subscribing. Please wait for admin approval.',
      });
    }

    // Check if already on this plan and active
    const existing = await Subscription.findOne({ userId: req.user._id }).lean();
    if (existing?.plan === planId && existing?.status === 'active') {
      return res.status(400).json({ success: false, message: `You are already on the ${plan.name} plan.` });
    }

    const user  = await User.findById(req.user._id).select('email name phone').lean();
    const email = user.email || `${String(user.phone).replace(/\+/g, '')}@fixng.app`;
    const name  = user.name || 'FixNG User';

    const { payment_link, tx_ref } = await initializePayment({
      email,
      name,
      amount: plan.price,   // Naira — Flutterwave uses real currency, not kobo
      planId: plan.id,
      userId: req.user._id.toString(),
    });

    res.status(200).json({
      success: true,
      data: { payment_link, tx_ref, plan },
    });
  } catch (err) {
    console.error('initiateSubscription error:', err.message);
    res.status(500).json({ success: false, message: 'Payment initialisation failed. Please try again.' });
  }
};

// ─── POST /api/subscriptions/verify ──────────────────────────────────────────
exports.verifySubscription = async (req, res) => {
  try {
    const { tx_ref } = req.body;
    if (!tx_ref) {
      return res.status(400).json({ success: false, message: 'tx_ref is required.' });
    }

    const tx = await verifyPayment(tx_ref);

    if (tx.status !== 'successful') {
      return res.status(400).json({
        success: false,
        message: `Payment was not successful (status: ${tx.status}).`,
      });
    }

    if (tx.currency !== 'NGN') {
      return res.status(400).json({ success: false, message: 'Invalid payment currency.' });
    }

    const { userId, plan: planId } = tx.meta || {};
    const plan = PLANS[planId];

    if (!plan || plan.id === 'free') {
      console.error('[verify] Unknown or free planId in metadata:', planId);
      return res.status(400).json({ success: false, message: 'Invalid payment metadata: unknown plan.' });
    }

    if (userId !== req.user._id.toString()) {
      console.error('[verify] userId mismatch. metadata:', userId, 'req:', req.user._id.toString());
      return res.status(400).json({ success: false, message: 'Invalid payment metadata: user mismatch.' });
    }

    if (tx.amount < plan.price) {
      return res.status(400).json({ success: false, message: 'Payment amount is less than the plan price.' });
    }

    await activateSubscription(req.user._id, plan, tx_ref);

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    notify(
      req.user._id,
      'profile_verified',
      `${plan.name} Plan Activated! 🎉`,
      `Your ${plan.name} subscription is active until ${expiresAt.toLocaleDateString('en-NG')}.`,
      {}
    );

    res.status(200).json({
      success: true,
      message: `${plan.name} subscription activated successfully.`,
      data: { plan, expiresAt },
    });
  } catch (err) {
    console.error('verifySubscription error:', err.message);
    res.status(500).json({ success: false, message: 'Verification failed. Contact support if funds were deducted.' });
  }
};

// ─── POST /api/subscriptions/cancel ──────────────────────────────────────────
exports.cancelSubscription = async (req, res) => {
  try {
    const sub = await Subscription.findOne({ userId: req.user._id });

    if (!sub || sub.plan === 'free') {
      return res.status(400).json({ success: false, message: 'No active paid subscription found.' });
    }

    await Subscription.findOneAndUpdate(
      { userId: req.user._id },
      { autoRenew: false, status: 'cancelled' }
    );

    res.status(200).json({
      success: true,
      message: 'Subscription cancelled. Access continues until the end of the current billing period.',
    });
  } catch (err) {
    console.error('cancelSubscription error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel subscription.' });
  }
};

// ─── POST /api/subscriptions/webhook ─────────────────────────────────────────
// Register this URL in Flutterwave Dashboard → Settings → Webhooks
// Set Secret Hash to FLW_WEBHOOK_HASH in your .env
exports.flutterwaveWebhook = async (req, res) => {
  if (req.headers['verif-hash'] !== process.env.FLW_WEBHOOK_HASH) {
    return res.status(401).end();
  }

  const payload = req.body;

  if (payload.event === 'charge.completed' && payload.data?.status === 'successful') {
    const tx     = payload.data;
    const { userId, plan: planId } = tx.meta || {};
    const plan   = PLANS[planId];

    if (!plan || plan.id === 'free' || !userId) return res.status(200).end();

    // Guard: currency and amount must match
    if (tx.currency !== 'NGN' || tx.amount < plan.price) return res.status(200).end();

    await activateSubscription(userId, plan, tx.tx_ref).catch(console.error);

    notify(
      userId,
      'profile_verified',
      `${plan.name} Plan Activated! 🎉`,
      `Your ${plan.name} subscription is now active.`,
      {}
    );
  }

  res.status(200).end();
};
