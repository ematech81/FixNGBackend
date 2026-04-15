const crypto       = require('crypto');
const Subscription = require('../models/Subscription');
const User         = require('../models/User');
const PLANS        = require('../constants/subscriptionPlans');
const { initializeTransaction, verifyTransaction } = require('../services/paystackService');
const { notify }   = require('./notificationController');

// ─── GET /api/subscriptions/plans — Public plan list ──────────────────────────
exports.getPlans = async (req, res) => {
  res.status(200).json({ success: true, data: Object.values(PLANS) });
};

// ─── GET /api/subscriptions/me — Current user's subscription ──────────────────
exports.getMySubscription = async (req, res) => {
  try {
    let sub = await Subscription.findOne({ userId: req.user._id }).lean();

    // Auto-create a free record if none exists
    if (!sub) {
      sub = await Subscription.create({ userId: req.user._id, plan: 'free' });
      sub = sub.toObject();
    }

    // Mark expired paid plans
    if (sub.plan !== 'free' && sub.expiresAt && new Date(sub.expiresAt) < new Date()) {
      await Subscription.findOneAndUpdate(
        { userId: req.user._id },
        { status: 'expired', plan: 'free' }
      );
      sub.status = 'expired';
      sub.plan   = 'free';
    }

    const planDetails = PLANS[sub.plan] || PLANS.free;
    res.status(200).json({ success: true, data: { ...sub, planDetails } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch subscription.' });
  }
};

// ─── POST /api/subscriptions/initiate — Start a Paystack checkout ────────────
exports.initiateSubscription = async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = PLANS[planId];

    if (!plan || plan.id === 'free') {
      return res.status(400).json({ success: false, message: 'Invalid plan selected.' });
    }

    const user = await User.findById(req.user._id).select('email name phone').lean();
    const email = user.email || `${user.phone}@fixng.app`; // Paystack requires an email

    const txData = await initializeTransaction({
      email,
      amountKobo: plan.paystackAmount,
      metadata: {
        userId:   req.user._id.toString(),
        planId:   plan.id,
        userName: user.name,
      },
    });

    res.status(200).json({
      success: true,
      data: {
        authorizationUrl: txData.authorization_url,
        reference:        txData.reference,
        plan,
      },
    });
  } catch (err) {
    console.error('initiateSubscription error:', err.message);
    res.status(500).json({ success: false, message: 'Payment initialisation failed. Please try again.' });
  }
};

// ─── POST /api/subscriptions/verify — Verify payment after redirect ───────────
exports.verifySubscription = async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Reference is required.' });
    }

    const tx = await verifyTransaction(reference);

    if (tx.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment was not successful.' });
    }

    const { planId, userId } = tx.metadata || {};
    const plan = PLANS[planId];

    if (!plan || userId !== req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Invalid payment metadata.' });
    }

    // Activate subscription — 30-day rolling window
    const now       = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const sub = await Subscription.findOneAndUpdate(
      { userId: req.user._id },
      {
        plan: plan.id,
        status:              'active',
        startDate:           now,
        expiresAt,
        paystackReference:   reference,
        autoRenew:           true,
        $push: {
          history: {
            plan:      plan.id,
            amount:    plan.price,
            reference,
            paidAt:    now,
          },
        },
      },
      { upsert: true, new: true }
    );

    // Notify the user
    notify(req.user._id, 'profile_verified',  // reuse closest type
      'Subscription Activated! 🎉',
      `Welcome to ${plan.name}. Your subscription is active until ${expiresAt.toLocaleDateString('en-NG')}.`,
      {}
    );

    res.status(200).json({
      success: true,
      message: `${plan.name} subscription activated.`,
      data: sub,
    });
  } catch (err) {
    console.error('verifySubscription error:', err.message);
    res.status(500).json({ success: false, message: 'Verification failed. Contact support.' });
  }
};

// ─── POST /api/subscriptions/cancel — Cancel auto-renew ──────────────────────
exports.cancelSubscription = async (req, res) => {
  try {
    await Subscription.findOneAndUpdate(
      { userId: req.user._id },
      { autoRenew: false, status: 'cancelled' }
    );
    res.status(200).json({
      success: true,
      message: 'Subscription cancelled. Access continues until the current period ends.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to cancel subscription.' });
  }
};

// ─── POST /api/subscriptions/webhook — Paystack event webhook ─────────────────
// Set this URL in your Paystack dashboard → Settings → Webhooks
exports.paystackWebhook = async (req, res) => {
  // Verify the webhook signature
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).json({ message: 'Invalid signature.' });
  }

  const { event, data } = req.body;

  if (event === 'charge.success') {
    const { metadata, reference } = data;
    const { userId, planId } = metadata || {};
    const plan = PLANS[planId];
    if (!plan || !userId) return res.sendStatus(200);

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await Subscription.findOneAndUpdate(
      { userId },
      {
        plan:              plan.id,
        status:            'active',
        startDate:         new Date(),
        expiresAt,
        paystackReference: reference,
        autoRenew:         true,
        $push: {
          history: { plan: plan.id, amount: plan.price, reference, paidAt: new Date() },
        },
      },
      { upsert: true }
    );

    notify(userId, 'profile_verified',
      'Payment Confirmed 🎉',
      `Your ${plan.name} subscription has been renewed.`,
      {}
    );
  }

  if (event === 'subscription.disable') {
    const userId = data.metadata?.userId;
    if (userId) {
      await Subscription.findOneAndUpdate({ userId }, { autoRenew: false, status: 'cancelled' });
    }
  }

  res.sendStatus(200);
};
