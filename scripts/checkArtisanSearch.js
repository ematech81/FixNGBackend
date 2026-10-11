'use strict';

// Self-check for the artisan list. Run it any time (and after every deploy that touches search):
//
//     npm run check:search
//
// It exits with an error if the list ever skips, repeats or mis-orders an artisan.
// READ-ONLY against your real data. The scale test creates a temporary collection with 1,500
// made-up artisans, tests it, and deletes it again (it never touches real artisans).

require('dotenv').config();
const mongoose = require('mongoose');
const ArtisanProfile = require('../src/models/ArtisanProfile');
const User = require('../src/models/User');
const { searchableQuery } = require('../src/utils/artisanVisibility');
const { findArtisansPage, distanceKmExpr, BANDS_KM, UNKNOWN_KM } = require('../src/services/artisanSearch');
const { haversineKm } = require('../src/utils/nigeriaGeo');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   (' + detail + ')' : ''}`);
};

const bandOf = (km) => { if (km >= UNKNOWN_KM) return BANDS_KM.length + 1; const i = BANDS_KM.findIndex((b) => km <= b); return i === -1 ? BANDS_KM.length : i; };
const kmFor = (doc, lat, lng) => {
  const c = doc.location?.coordinates;
  return Array.isArray(c) && c.length === 2 ? haversineKm(lat, lng, c[1], c[0]) : UNKNOWN_KM;
};

// Walk every page and return ids in the order served
const walk = async ({ model, query, lat, lng, size, maxDistanceKm }) => {
  const ids = []; const totals = new Set(); let page = 1; let hasMore = true; let pages = 0;
  while (hasMore && page < 500) {
    const { profiles, total } = await findArtisansPage({ model, query, lat, lng, maxDistanceKm, page, limit: size });
    totals.add(total);
    ids.push(...profiles.map((p) => String(p._id)));
    hasMore = (page - 1) * size + size < total;
    page++; pages++;
  }
  return { ids, totals: [...totals], pages };
};

const verifyList = (label, ids, expectedIds, totals) => {
  check(`${label}: every artisan appears`, ids.length === expectedIds.length && expectedIds.every((id) => new Set(ids).has(id)), `${ids.length} of ${expectedIds.length}`);
  check(`${label}: nobody appears twice`, new Set(ids).size === ids.length);
  check(`${label}: the reported total is the same on every page`, totals.length === 1 && totals[0] === expectedIds.length, `totals seen: ${totals.join(',')}`);
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  // ═════════ Part 1: your real artisans ═════════
  console.log('\n── Real artisans ──');
  const query = await searchableQuery();
  const docs = await ArtisanProfile.find(query).select('location isPro stats').lean();
  const expected = docs.map((d) => String(d._id));
  console.log(`   ${docs.length} artisans are visible to customers`);
  check('admin dashboard count rule == search rule', (await ArtisanProfile.countDocuments(query)) === docs.length);

  const spots = { 'Ikeja (Lagos)': [6.6018, 3.3515], 'Abuja': [9.0765, 7.3986], 'Port Harcourt': [4.8156, 7.0498], 'Kano': [12.0022, 8.592], 'middle of the ocean': [0, 0] };
  for (const size of [7, 24, 50]) {
    const r = await walk({ query, size });
    verifyList(`no location, ${size}/page`, r.ids, expected, r.totals);
  }
  for (const [name, [lat, lng]] of Object.entries(spots)) {
    for (const size of [10, 24]) {
      const r = await walk({ query, lat, lng, size });
      verifyList(`from ${name}, ${size}/page`, r.ids, expected, r.totals);
      if (size === 24) {
        const byId = new Map(docs.map((d) => [String(d._id), d]));
        const bands = r.ids.map((id) => bandOf(kmFor(byId.get(id), lat, lng)));
        check(`from ${name}: nearest band first, never goes back`, bands.every((b, i) => i === 0 || b >= bands[i - 1]));
        const again = await walk({ query, lat, lng, size });
        check(`from ${name}: identical order on a second pass`, JSON.stringify(again.ids) === JSON.stringify(r.ids));
      }
    }
  }
  // explicit radius still narrows
  const r20 = await walk({ query, lat: 6.6018, lng: 3.3515, size: 50, maxDistanceKm: 20 });
  const expected20 = docs.filter((d) => kmFor(d, 6.6018, 3.3515) <= 20).map((d) => String(d._id));
  verifyList('explicit 20 km radius', r20.ids, expected20, r20.totals);

  // distance maths in the database vs. plain JavaScript
  const raw = await ArtisanProfile.aggregate([{ $match: query }, { $addFields: { d: distanceKmExpr(6.6018, 3.3515) } }, { $project: { d: 1, location: 1 } }]);
  const worst = raw.reduce((m, r) => { const js = kmFor(r, 6.6018, 3.3515); return js >= UNKNOWN_KM ? m : Math.max(m, Math.abs(js - r.d)); }, 0);
  check('database distance matches the JavaScript formula', worst < 0.05, `largest difference ${worst.toFixed(4)} km`);

  // ═════════ Part 2: 1,500 made-up artisans (temporary, deleted afterwards) ═════════
  console.log('\n── Scale: 1,500 artisans (temporary collection) ──');
  const dropWithRetry = async (name) => {
    for (let i = 0; i < 5; i++) {
      try { await mongoose.connection.db.collection(name).drop(); return true; }
      catch (e) { if (e.codeName === 'NamespaceNotFound') return true; await new Promise((r) => setTimeout(r, 700)); }
    }
    return false;
  };
  // Remove leftovers from any earlier interrupted run
  for (const c of await mongoose.connection.db.listCollections().toArray()) {
    if (/^zz_search_scale_test_\d+$/.test(c.name)) await dropWithRetry(c.name);
  }
  const tmpName = `zz_search_scale_test_${Date.now()}`;
  const Tmp = mongoose.model(`ScaleTest${Date.now()}`, ArtisanProfile.schema, tmpName);
  try {
    const N = 1500; let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const fake = [];
    for (let i = 0; i < N; i++) {
      const kind = i % 25;                                            // some awkward artisans on purpose
      const coordinates = kind === 0 || kind === 1 ? undefined : kind === 2 ? [0, 0]      // 0/1: no location field at all (the database rejects empty/invalid points)
        : kind < 8 ? [3.3792, 6.5244]                                  // many at the exact same spot (ties)
        : [3 + rnd() * 11, 4 + rnd() * 9];                             // spread over Nigeria
      fake.push({
        userId: new mongoose.Types.ObjectId(), skills: ['Plumber'], verificationStatus: 'verified',
        isPro: rnd() < 0.06, stats: { averageRating: kind % 3 === 0 ? 0 : Math.round(rnd() * 5 * 2) / 2, completedJobs: kind % 4 },
        ...(coordinates !== undefined ? { location: { type: 'Point', coordinates, state: 'Lagos' } } : {}),
      });
    }
    await Tmp.collection.insertMany(fake);
    const all = (await Tmp.find({}).select('location').lean());
    const allIds = all.map((d) => String(d._id));
    const byId = new Map(all.map((d) => [String(d._id), d]));
    const [lat, lng] = [6.6018, 3.3515];

    for (const size of [24, 50]) {
      const t0 = Date.now();
      const r = await walk({ model: Tmp, query: {}, lat, lng, size });
      const ms = Date.now() - t0;
      verifyList(`1,500 from Ikeja, ${size}/page`, r.ids, allIds, r.totals);
      console.log(`   ${r.pages} pages in ${ms} ms (${Math.round(ms / r.pages)} ms per page)`);
      const bands = r.ids.map((id) => bandOf(kmFor(byId.get(id), lat, lng)));
      check(`1,500 from Ikeja, ${size}/page: nearest band first`, bands.every((b, i) => i === 0 || b >= bands[i - 1]));
      const missing = r.ids.filter((id) => kmFor(byId.get(id), lat, lng) >= UNKNOWN_KM);
      check(`1,500 from Ikeja, ${size}/page: artisans with no usable location are included, at the end`, missing.length === N / 25 * 2 && r.ids.slice(-missing.length).every((id) => kmFor(byId.get(id), lat, lng) >= UNKNOWN_KM), `${missing.length} without location`);
      const again = await walk({ model: Tmp, query: {}, lat, lng, size });
      check(`1,500 from Ikeja, ${size}/page: identical order on a second pass (ties are stable)`, JSON.stringify(again.ids) === JSON.stringify(r.ids));
    }
    const noLoc = await walk({ model: Tmp, query: {}, size: 50 });
    verifyList('1,500 with no location, 50/page', noLoc.ids, allIds, noLoc.totals);
  } finally {
    const gone = await dropWithRetry(tmpName);
    check('temporary test collection was deleted', gone);
  }
  const stray = (await mongoose.connection.db.listCollections().toArray()).filter((c) => c.name.startsWith('zz_search_scale_test_'));
  check('nothing left behind in the database', stray.length === 0);

  await mongoose.disconnect();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => { console.error('CHECK ERROR:', e); try { await mongoose.disconnect(); } catch {} process.exit(2); });
