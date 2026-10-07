'use strict';

// One-off: give artisans who were saved at the fake "centre of Nigeria" point a real
// approximate location (geocoded from their address / LGA / state).
//
//   node scripts/backfillLocations.js            -> DRY RUN: prints what would change, writes nothing
//   node scripts/backfillLocations.js --apply    -> writes the new coordinates
//
// Uses OpenStreetMap Nominatim at ~1 request/second (its usage policy), so it takes a
// couple of seconds per artisan. Output shows state/LGA and result only — no names or street addresses.

require('dotenv').config();
const mongoose = require('mongoose');
const ArtisanProfile = require('../src/models/ArtisanProfile');
const { geocodeNigeria, isDefaultCoords, STATE_CENTRES, haversineKm } = require('../src/utils/nigeriaGeo');

const APPLY = process.argv.includes('--apply');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  const profiles = await ArtisanProfile.find({}).select('location').lean();
  const todo = profiles.filter((p) => isDefaultCoords(p.location?.coordinates) && p.location?.state);
  const noLocation = profiles.filter((p) => isDefaultCoords(p.location?.coordinates) && !p.location?.state).length;

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${profiles.length} profiles; ${todo.length} at the default point with a state; ${noLocation} have no location yet (skipped).`);

  const bySource = {};
  let written = 0;
  for (const p of todo) {
    const { address, lga, state } = p.location;
    const g = await geocodeNigeria({ address, lga, state });
    bySource[g.source] = (bySource[g.source] || 0) + 1;

    const c = STATE_CENTRES[state];
    const fromCity = c ? Math.round(haversineKm(g.lat, g.lng, c[0], c[1])) : '?';
    console.log(`${String(state).padEnd(12)} ${String(lga || '-').padEnd(18)} -> ${g.source.padEnd(7)} (${g.lat.toFixed(3)}, ${g.lng.toFixed(3)})  ${fromCity} km from ${state} main city`);

    if (APPLY) {
      await ArtisanProfile.updateOne(
        { _id: p._id },
        { $set: { 'location.coordinates': [g.lng, g.lat], 'location.geoSource': g.source } }
      );
      written += 1;
    }
    await sleep(2200); // stay within Nominatim's 1 request/second policy (up to 2 lookups per artisan)
  }

  console.log('\nResult by source:', JSON.stringify(bySource));
  console.log(APPLY ? `Updated ${written} profiles.` : 'Dry run only — nothing was written. Re-run with --apply to save.');
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
