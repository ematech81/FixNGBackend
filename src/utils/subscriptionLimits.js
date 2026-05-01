const Subscription = require('../models/Subscription');

const TIER_LIMITS = {
  free:    { maxActiveJobs: 2 },
  basic:   { maxActiveJobs: 10 },
  premium: { maxActiveJobs: Infinity },
};

/**
 * Returns the artisan's effective plan ('free' | 'basic' | 'premium').
 * Expired or cancelled paid plans fall back to 'free'.
 */
async function getArtisanPlan(userId) {
  const sub = await Subscription.findOne({ userId }).lean();
  if (!sub || sub.plan === 'free') return 'free';
  if (sub.status !== 'active') return 'free';
  if (sub.expiresAt && new Date(sub.expiresAt) < new Date()) return 'free';
  return sub.plan;
}

module.exports = { TIER_LIMITS, getArtisanPlan };
