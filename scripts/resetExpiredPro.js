'use strict';

/**
 * resetExpiredPro.js
 * ──────────────────
 * One-time diagnostic + repair script.
 *
 * What it does:
 *  1. Prints a report of every Pro artisan and their subscription state.
 *  2. Strips isPro from artisans whose subscription is expired/cancelled
 *     (regardless of proSource — useful for resetting test data).
 *  3. Transitions any Subscription docs that are overdue but still
 *     set to an active status.
 *
 * Usage:
 *   node scripts/resetExpiredPro.js           -- dry run (report only)
 *   node scripts/resetExpiredPro.js --fix     -- apply changes
 *
 * Run from the FixNGBackend directory:
 *   cd FixNGBackend && node scripts/resetExpiredPro.js --fix
 */

require('dotenv').config();
const mongoose    = require('mongoose');
const ArtisanProfile = require('../src/models/ArtisanProfile');
const Subscription   = require('../src/models/Subscription');
const User           = require('../src/models/User');

const DRY_RUN = !process.argv.includes('--fix');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const now = new Date();

  // ── 1. Report every Pro artisan ──────────────────────────────────────────
  const proArtisans = await ArtisanProfile.find({ isPro: true })
    .populate('userId', 'name phone')
    .lean();

  console.log(`Found ${proArtisans.length} artisan(s) with isPro=true\n`);
  console.log('─'.repeat(80));

  for (const p of proArtisans) {
    const name      = p.userId?.name ?? '(unknown)';
    const phone     = p.userId?.phone ?? '';
    const proSource = p.proSource ?? 'null';
    const sub       = await Subscription.findOne({ artisanId: p.userId?._id }).lean();

    const subInfo = sub
      ? `status=${sub.status}  endsAt=${sub.endsAt?.toISOString().slice(0,10) ?? 'N/A'}`
      : 'NO SUBSCRIPTION DOCUMENT';

    const overdue  = sub && ['expired', 'cancelled'].includes(sub.status);
    const noSub    = !sub;
    const needsFix = overdue || noSub;

    console.log(
      `${needsFix ? '⚠️ ' : '✅'} ${name} (${phone})\n` +
      `   proSource: ${proSource}\n` +
      `   subscription: ${subInfo}\n` +
      `   action needed: ${needsFix ? 'STRIP isPro' : 'none'}\n`
    );
  }

  console.log('─'.repeat(80));

  // ── 2. Overdue Subscription docs not yet transitioned ───────────────────
  const overdueActive = await Subscription.find({
    status: { $in: ['trial', 'active'] },
    endsAt: { $lt: now },
  }).lean();

  const overdueGrace = await Subscription.find({
    status: 'grace',
    graceEndsAt: { $lt: now },
  }).lean();

  console.log(`\nOverdue active/trial subs: ${overdueActive.length}`);
  console.log(`Overdue grace subs: ${overdueGrace.length}`);

  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN — no changes applied.');
    console.log('   Run with --fix to apply all changes.\n');
    await mongoose.disconnect();
    return;
  }

  // ── 3. Apply fixes ───────────────────────────────────────────────────────
  console.log('\n🔧 Applying fixes...\n');

  let stripped = 0;

  for (const p of proArtisans) {
    const artisanId = p.userId?._id;
    if (!artisanId) continue;

    const sub = await Subscription.findOne({ artisanId }).lean();
    const shouldStrip = !sub || ['expired', 'cancelled'].includes(sub.status);

    if (shouldStrip) {
      // Strip Pro regardless of proSource (test data reset)
      await ArtisanProfile.findOneAndUpdate(
        { userId: artisanId },
        { $set: { isPro: false, proSource: null, proGrantedAt: null, proGrantedBy: null } }
      );
      console.log(`  ✓ Stripped Pro from ${p.userId?.name}`);
      stripped++;
    }
  }

  // Transition overdue subscriptions
  for (const sub of overdueActive) {
    const newStatus = sub.isCancelling ? 'cancelled' : sub.status === 'trial' ? 'expired' : 'grace';
    await Subscription.findByIdAndUpdate(sub._id, { status: newStatus });
    console.log(`  ✓ Sub ${sub._id}: ${sub.status} → ${newStatus}`);
  }

  for (const sub of overdueGrace) {
    const newStatus = sub.isCancelling ? 'cancelled' : 'expired';
    await Subscription.findByIdAndUpdate(sub._id, { status: newStatus });
    // Also strip Pro
    await ArtisanProfile.findOneAndUpdate(
      { userId: sub.artisanId },
      { $set: { isPro: false, proSource: null, proGrantedAt: null, proGrantedBy: null } }
    );
    console.log(`  ✓ Sub ${sub._id}: grace → ${newStatus}, Pro stripped`);
  }

  console.log(`\n✅ Done — stripped Pro from ${stripped} artisan(s), transitioned ${overdueActive.length + overdueGrace.length} subscription(s)`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
