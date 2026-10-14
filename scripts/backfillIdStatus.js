'use strict';

// One-off: set idStatus on existing artisans after the "badge needs an approved ID" change.
//
//   node scripts/backfillIdStatus.js                 DRY RUN: shows the counts, changes nothing
//   node scripts/backfillIdStatus.js --apply         apply
//   node scripts/backfillIdStatus.js --apply --grandfather
//        artisans who already uploaded an ID are marked 'approved' (keep their tick)
//        (default without --grandfather: they go to 'pending' so you review the ID first)
//
// Artisans with NO ID uploaded are always set to 'none' (they lose the tick until they verify).
// Admin-granted Pro is left untouched.

require('dotenv').config();
const mongoose = require('mongoose');
const ArtisanProfile = require('../src/models/ArtisanProfile');

const APPLY = process.argv.includes('--apply');
const GRANDFATHER = process.argv.includes('--grandfather');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const profiles = await ArtisanProfile.find({ idStatus: { $exists: false } })
    .select('verificationId verificationStatus idStatus badgeLevel').lean();

  const withId = profiles.filter((p) => p.verificationId?.url);
  const withoutId = profiles.filter((p) => !p.verificationId?.url);
  const withIdStatus = GRANDFATHER ? 'approved' : 'pending';

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${profiles.length} profiles without idStatus`);
  console.log(`  with an uploaded ID: ${withId.length}  -> idStatus '${withIdStatus}'`);
  console.log(`  without an ID:       ${withoutId.length}  -> idStatus 'none' (tick removed)`);

  if (APPLY) {
    if (withId.length) await ArtisanProfile.updateMany({ _id: { $in: withId.map((p) => p._id) } }, { $set: { idStatus: withIdStatus } });
    if (withoutId.length) await ArtisanProfile.updateMany({ _id: { $in: withoutId.map((p) => p._id) } }, { $set: { idStatus: 'none' } });

    // Recompute badgeLevel through the model hook (updateMany skips it)
    let fixed = 0;
    for await (const doc of ArtisanProfile.find({ _id: { $in: profiles.map((p) => p._id) } })) {
      const before = doc.badgeLevel;
      await doc.save();
      if (doc.badgeLevel !== before) fixed += 1;
    }
    console.log(`Done. Badge level changed on ${fixed} profile(s).`);
  } else {
    console.log('Nothing changed. Add --apply to apply.');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
