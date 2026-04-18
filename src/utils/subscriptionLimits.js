const Subscription = require('../models/Subscription');

const TIER_LIMITS = {
  free:  { maxActiveJobs: 2 },
  pro:   { maxActiveJobs: 10 },
  elite: { maxActiveJobs: Infinity },
};

/**
 * Returns the artisan's effective subscription plan ('free' | 'pro' | 'elite').
 * Treats expired or cancelled paid plans as 'free'.
 */
async function getArtisanPlan(userId) {
  const sub = await Subscription.findOne({ userId }).lean();
  if (!sub || sub.plan === 'free') return 'free';
  if (sub.status !== 'active') return 'free';
  if (sub.expiresAt && new Date(sub.expiresAt) < new Date()) return 'free';
  return sub.plan;
}

module.exports = { TIER_LIMITS, getArtisanPlan };
