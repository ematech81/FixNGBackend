// Backfills artisanCode for all existing artisan accounts that don't have one.
// Usage:
//   node scripts/migrateArtisanCodes.js          — live run
//   node scripts/migrateArtisanCodes.js --dry-run — preview only, no DB writes

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');
const { generateArtisanCode } = require('../src/utils/generateArtisanCode');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to MongoDB.${DRY_RUN ? ' [DRY RUN — no writes]' : ''}\n`);

  const artisans = await User.find({ role: 'artisan', artisanCode: null }).lean();
  console.log(`Found ${artisans.length} artisans without a code.\n`);

  let assigned = 0;
  let failed = 0;

  for (const user of artisans) {
    try {
      const code = await generateArtisanCode(User);
      if (!DRY_RUN) {
        await User.findByIdAndUpdate(user._id, { artisanCode: code });
      }
      console.log(`  [${DRY_RUN ? 'DRY' : 'OK '}] ${user.name} (${user.phone}) → ${code}`);
      assigned++;
    } catch (err) {
      console.error(`  [FAIL] ${user.name} (${user.phone}): ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Assigned: ${assigned}  Failed: ${failed}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
