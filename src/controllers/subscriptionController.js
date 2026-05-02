const crypto         = require('crypto');
const Subscription   = require('../models/Subscription');
const ArtisanProfile = require('../models/ArtisanProfile');
const User           = require('../models/User');
const PLANS          = require('../constants/subscriptionPlans');
const {
  initializeTransaction,
  verifyTransaction,
} = require('../services/paystackService');
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
const activateSubscription = async (userId, plan, reference, subscriptionCode, customerCode) => {
  const now      = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await Subscription.findOneAndUpdate(
    { userId },
    {
      plan:                      plan.id,
      status:                    'active',
      startDate:                 now,
      expiresAt,
      paystackReference:         reference,
      paystackSubscriptionCode:  subscriptionCode || null,
      paystackCustomerCode:      customerCode     || null,
      autoRenew:                 true,
      $push: {
        history: {
          plan:      plan.id,
          amount:    plan.price,
          currency:  '₦',
          reference,
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

    if (!plan.paystackPlanCode) {
      return res.status(503).json({
        success: false,
        message: 'This plan is not yet configured. Please contact support.',
      });
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

    // Check if already on this plan
    const existing = await Subscription.findOne({ userId: req.user._id }).lean();
    if (existing?.plan === planId && existing?.status === 'active') {
      return res.status(400).json({ success: false, message: `You are already on the ${plan.name} plan.` });
    }

    const user  = await User.findById(req.user._id).select('email name phone').lean();
    const email = user.email || `${user.phone.replace(/\+/g, '')}@fixng.app`;

    const txData = await initializeTransaction({
      email,
      amountKobo: plan.paystackAmount,
      planCode:   plan.paystackPlanCode,
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
        accessCode:       txData.access_code,
        reference:        txData.reference,
        plan,
      },
    });
  } catch (err) {
    console.error('initiateSubscription error:', err.message);
    res.status(500).json({ success: false, message: 'Payment initialisation failed. Please try again.' });
  }
};

// ─── POST /api/subscriptions/verify ──────────────────────────────────────────
exports.verifySubscription = async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Reference is required.' });
    }

    const tx = await verifyTransaction(reference);

    console.log('[verify] tx.status:', tx.status);
    console.log('[verify] tx.metadata:', JSON.stringify(tx.metadata));
    console.log('[verify] req.user._id:', req.user._id.toString());

    if (tx.status !== 'success') {
      return res.status(400).json({ success: false, message: `Payment was not successful (status: ${tx.status}).` });
    }

    const { planId, userId } = tx.metadata || {};
    const plan = PLANS[planId];

    if (!plan) {
      console.error('[verify] Unknown planId in metadata:', planId);
      return res.status(400).json({ success: false, message: 'Invalid payment metadata: unknown plan.' });
    }
    if (userId !== req.user._id.toString()) {
      console.error('[verify] userId mismatch. metadata:', userId, 'req:', req.user._id.toString());
      return res.status(400).json({ success: false, message: 'Invalid payment metadata: user mismatch.' });
    }

    // Paystack includes subscription details when a plan code was used
    const subscriptionCode = tx.subscription?.subscription_code || null;
    const customerCode     = tx.customer?.customer_code         || null;

    await activateSubscription(req.user._id, plan, reference, subscriptionCode, customerCode);

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
// Register this URL in Paystack Dashboard → Settings → Webhooks
exports.paystackWebhook = async (req, res) => {
  // Verify Paystack signature against raw body buffer
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).json({ message: 'Invalid signature.' });
  }

  const { event, data } = JSON.parse(req.body);

  // ── First payment or manual charge ────────────────────────────────────────
  if (event === 'charge.success') {
    const { metadata, reference, subscription: sub, customer } = data;
    const { userId, planId } = metadata || {};
    const plan = PLANS[planId];
    if (!plan || !userId) return res.sendStatus(200);

    await activateSubscription(
      userId,
      plan,
      reference,
      sub?.subscription_code || null,
      customer?.customer_code || null
    );

    notify(userId, 'profile_verified',
      `${plan.name} Plan Activated! 🎉`,
      `Your ${plan.name} subscription is now active.`,
      {}
    );
  }

  // ── Recurring renewal ─────────────────────────────────────────────────────
  if (event === 'invoice.payment_succeeded') {
    const paystackSub = data.subscription;
    const planCode    = paystackSub?.plan?.plan_code;

    const plan = Object.values(PLANS).find(p => p.paystackPlanCode === planCode);
    if (!plan) return res.sendStatus(200);

    const sub = await Subscription.findOne({
      paystackSubscriptionCode: paystackSub.subscription_code,
    });
    if (!sub) return res.sendStatus(200);

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await Subscription.findOneAndUpdate(
      { _id: sub._id },
      {
        plan:      plan.id,
        status:    'active',
        expiresAt,
        autoRenew: true,
        $push: {
          history: {
            plan:      plan.id,
            amount:    plan.price,
            currency:  '₦',
            reference: data.reference || '',
            paidAt:    new Date(),
          },
        },
      }
    );

    await syncProStatus(sub.userId, true, 'subscription');

    notify(sub.userId, 'profile_verified',
      'Subscription Renewed ✅',
      `Your ${plan.name} plan has been renewed for another month.`,
      {}
    );
  }

  // ── Subscription disabled / cancelled ─────────────────────────────────────
  if (event === 'subscription.disable') {
    const subscriptionCode = data.subscription_code;
    if (subscriptionCode) {
      const sub = await Subscription.findOneAndUpdate(
        { paystackSubscriptionCode: subscriptionCode },
        { autoRenew: false, status: 'cancelled' }
      );
      if (sub) await syncProStatus(sub.userId, false);
    }
  }

  res.sendStatus(200);
};
