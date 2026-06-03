const Subscription   = require('../models/Subscription');
const ArtisanProfile = require('../models/ArtisanProfile');

const TIER_LIMITS = {
  free: { maxActiveJobs: 2 },
  pro:  { maxActiveJobs: Infinity },
};

/**
 * Returns the artisan's effective plan ('free' | 'pro').
 * Pro access is granted when:
 *   - Subscription status is trial, active, or grace, OR
 *   - Admin has manually set ArtisanProfile.isPro = true
 */
async function getArtisanPlan(artisanId) {
  const [sub, profile] = await Promise.all([
    Subscription.findOne({ artisanId }).select('status').lean(),
    ArtisanProfile.findOne({ userId: artisanId }).select('isPro').lean(),
  ]);

  if (sub && ['trial', 'active', 'grace'].includes(sub.status)) return 'pro';
  if (profile?.isPro) return 'pro';

  return 'free';
}

module.exports = { TIER_LIMITS, getArtisanPlan };
