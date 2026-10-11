'use strict';

// THE one definition of "a customer can see this artisan".
// Used by the public search AND the admin dashboard's "Verified Artisans" count, so the two
// numbers can never drift apart again (they once showed 88 vs 46).
//
// An artisan is visible when ALL of these hold:
//   • verification status is 'verified' and they have at least one skill (their profile page works)
//   • the profile is not suspended or banned
//   • their account still exists and is active (profiles of deleted/disabled users are not shown —
//     they used to be counted but never displayed, which broke paging)

const User = require('../models/User');

const searchableQuery = async () => ({
  verificationStatus: 'verified',
  'skills.0': { $exists: true },
  isSuspended: { $ne: true },
  isBanned: { $ne: true },
  userId: { $in: await User.distinct('_id', { role: 'artisan', isActive: { $ne: false } }) },
});

module.exports = { searchableQuery };
