'use strict';

const cron         = require('node-cron');
const Subscription = require('../models/Subscription');
const { syncProStatus } = require('../helpers/subscriptionHelper');
const { notify }   = require('../controllers/notificationController');

const tick = async () => {
  const now = new Date();
  console.log('[subscriptionTick] running at', now.toISOString());

  try {
    // ── active → grace ──────────────────────────────────────────────────────
    const toGrace = await Subscription.find({ status: 'active', endsAt: { $lt: now } });
    for (const sub of toGrace) {
      await Subscription.findByIdAndUpdate(sub._id, { status: 'grace' });
      notify(
        sub.artisanId,
        'subscription',
        'Subscription Expired',
        `Your Pro subscription has expired. You have ${process.env.SUB_GRACE_DAYS || 3} days to renew before being removed from search results.`,
        {}
      );
      console.log('[subscriptionTick] active→grace', sub.artisanId);
    }

    // ── grace → expired ──────────────────────────────────────────────────────
    const toExpired = await Subscription.find({ status: 'grace', graceEndsAt: { $lt: now } });
    for (const sub of toExpired) {
      await Subscription.findByIdAndUpdate(sub._id, { status: 'expired' });
      await syncProStatus(sub.artisanId, false);
      notify(
        sub.artisanId,
        'subscription',
        'Subscription Ended',
        'Your grace period has ended. Subscribe to be discoverable again and receive new jobs.',
        {}
      );
      console.log('[subscriptionTick] grace→expired', sub.artisanId);
    }

    // ── trial → expired ──────────────────────────────────────────────────────
    const trialExpired = await Subscription.find({ status: 'trial', endsAt: { $lt: now } });
    for (const sub of trialExpired) {
      await Subscription.findByIdAndUpdate(sub._id, { status: 'expired' });
      await syncProStatus(sub.artisanId, false);
      notify(
        sub.artisanId,
        'subscription',
        'Free Trial Ended',
        'Your 7-day free trial has ended. Subscribe to continue appearing in search results and receiving job requests.',
        {}
      );
      console.log('[subscriptionTick] trial→expired', sub.artisanId);
    }
  } catch (err) {
    console.error('[subscriptionTick] error:', err.message);
  }
};

module.exports = () => {
  // Run once immediately on startup to catch any transitions missed while server was down
  tick();
  // Then every hour
  cron.schedule('0 * * * *', tick);
  console.log('[subscriptionTick] scheduled — runs hourly');
};
