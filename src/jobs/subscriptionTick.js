'use strict';

const cron         = require('node-cron');
const Subscription = require('../models/Subscription');
const Job          = require('../models/Job');
const { syncProStatus } = require('../helpers/subscriptionHelper');
const { notify }   = require('../controllers/notificationController');

const tick = async () => {
  const now = new Date();
  console.log('[subscriptionTick] running at', now.toISOString());

  try {
    // ── active (isCancelling) → cancelled ──────────────────────────────────
    // Artisan requested cancellation — period is now over. Skip grace entirely.
    const cancellingExpired = await Subscription.find({
      status:       'active',
      isCancelling: true,
      endsAt:       { $lt: now },
    });
    for (const sub of cancellingExpired) {
      await Subscription.findByIdAndUpdate(sub._id, { status: 'cancelled' });
      await syncProStatus(sub.artisanId, false);
      notify(
        sub.artisanId,
        'subscription',
        'Subscription Ended',
        'Your cancelled subscription has ended. Subscribe anytime to regain Pro access.',
        {}
      );
      console.log('[subscriptionTick] active(cancelling)→cancelled', sub.artisanId);
    }

    // ── active (not cancelling) → grace ────────────────────────────────────
    const toGrace = await Subscription.find({
      status:       'active',
      isCancelling: { $ne: true },
      endsAt:       { $lt: now },
    });
    for (const sub of toGrace) {
      await Subscription.findByIdAndUpdate(sub._id, { status: 'grace' });
      notify(
        sub.artisanId,
        'subscription',
        'Subscription Expired',
        `Your Pro subscription has expired. You have ${process.env.SUB_GRACE_DAYS || 3} days to renew before your Pro badge is removed and your listing is deprioritised in search results.`,
        {}
      );
      console.log('[subscriptionTick] active→grace', sub.artisanId);
    }

    // ── grace → expired (or cancelled if isCancelling) ─────────────────────
    const toExpired = await Subscription.find({ status: 'grace', graceEndsAt: { $lt: now } });
    for (const sub of toExpired) {
      const newStatus = sub.isCancelling ? 'cancelled' : 'expired';
      await Subscription.findByIdAndUpdate(sub._id, { status: newStatus });
      await syncProStatus(sub.artisanId, false);
      notify(
        sub.artisanId,
        'subscription',
        'Subscription Ended',
        sub.isCancelling
          ? 'Your cancelled subscription grace period has ended. Subscribe anytime to regain Pro access.'
          : 'Your grace period has ended. Your Pro badge has been removed and you now appear lower in search results. Subscribe anytime to restore your Pro badge and priority placement.',
        {}
      );
      console.log(`[subscriptionTick] grace→${newStatus}`, sub.artisanId);
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
        'Your 7-day free trial has ended. You are still visible to clients and can receive job requests — but your Pro badge has been removed and you now appear lower in search results. Subscribe to restore your Pro badge and priority placement.',
        {}
      );
      console.log('[subscriptionTick] trial→expired', sub.artisanId);
    }

    // ── pending jobs past expiresAt → expired ────────────────────────────────
    const expiredJobs = await Job.updateMany(
      { status: 'pending', expiresAt: { $lt: now } },
      { $set: { status: 'expired' } }
    );
    if (expiredJobs.modifiedCount > 0) {
      console.log('[subscriptionTick] expired', expiredJobs.modifiedCount, 'stale jobs');
    }
  } catch (err) {
    console.error('[subscriptionTick] error:', err.message);
  }
};

module.exports = () => {
  // Run once immediately on startup to catch any transitions missed while server was down
  tick();
  // Run every 15 minutes (was hourly — faster transitions for paid subscriptions)
  cron.schedule('*/15 * * * *', tick);
  console.log('[subscriptionTick] scheduled — runs every 15 minutes');
};
