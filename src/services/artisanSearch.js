'use strict';

// Artisan listing: EVERY visible artisan, nearest first, in stable pages.
//
// Guarantees (verified by scripts/checkArtisanSearch.js):
//   1. Every artisan matching the filters is reachable by paging — there is no cap (it used to stop
//      at the nearest 500) and no artisan is dropped for lacking a usable location.
//   2. Paging never repeats or skips anyone: the order is fully deterministic (it ends with _id).
//   3. With a location the list is nearest-first. Without one it is simply everyone, best first.
//   4. A distance radius is applied ONLY when the caller explicitly asks for one.
//
// How: distance is computed in the database for every matching artisan (haversine), then sorted
// and paged there. That is exact and unbounded; at tens of thousands of artisans it could move to
// $geoNear, but at that size this is still fast.

const ArtisanProfile = require('../models/ArtisanProfile');
const User = require('../models/User');

// Distance bands, in km. The list is ordered by band first (nearest band first). INSIDE a band,
// Pro artisans come first (that is what a Pro subscription buys), then higher rating, then nearer.
// Everyone beyond the last band is in one final band. Tighten or widen these to taste.
const BANDS_KM = [3, 10, 25, 60, 150];

// Stand-in distance for an artisan with no usable coordinates: they sort to the very end, but are shown.
const UNKNOWN_KM = 1e9;

const EARTH_DIAMETER_KM = 12742;

/** MongoDB expression: great-circle distance in km from (lat, lng) to the artisan's stored point. */
const distanceKmExpr = (lat, lng) => ({
  $let: {
    vars: { c: '$location.coordinates' },
    in: {
      $cond: [
        { $and: [{ $isArray: '$$c' }, { $eq: [{ $size: '$$c' }, 2] }] },
        {
          $let: {
            vars: {
              lat1: { $degreesToRadians: lat },
              lng1: { $degreesToRadians: lng },
              lat2: { $degreesToRadians: { $arrayElemAt: ['$$c', 1] } },
              lng2: { $degreesToRadians: { $arrayElemAt: ['$$c', 0] } },
            },
            in: {
              $let: {
                vars: {
                  dLat: { $subtract: ['$$lat2', '$$lat1'] },
                  dLng: { $subtract: ['$$lng2', '$$lng1'] },
                },
                in: {
                  $multiply: [
                    EARTH_DIAMETER_KM,
                    {
                      $asin: {
                        $min: [
                          1,
                          {
                            $sqrt: {
                              $add: [
                                { $pow: [{ $sin: { $divide: ['$$dLat', 2] } }, 2] },
                                {
                                  $multiply: [
                                    { $cos: '$$lat1' },
                                    { $cos: '$$lat2' },
                                    { $pow: [{ $sin: { $divide: ['$$dLng', 2] } }, 2] },
                                  ],
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
        UNKNOWN_KM,
      ],
    },
  },
});

/** MongoDB expression: which distance band an artisan falls in (0 = nearest). */
const bandExpr = () => ({
  $switch: {
    branches: [
      // no usable location at all: their own band, always the very end of the list
      { case: { $gte: ['$distKm', UNKNOWN_KM] }, then: BANDS_KM.length + 1 },
      ...BANDS_KM.map((km, i) => ({ case: { $lte: ['$distKm', km] }, then: i })),
    ],
    default: BANDS_KM.length,
  },
});

const validCoords = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * One page of artisans.
 * @param {object}  p
 * @param {object}  p.query       Mongo filter (start from searchableQuery() and add filters)
 * @param {number}  [p.lat]       viewer's latitude  — with lng, switches on nearest-first
 * @param {number}  [p.lng]       viewer's longitude
 * @param {number}  [p.maxDistanceKm]  OPTIONAL hard radius; leave out to list everyone
 * @param {number}  p.page        1-based
 * @param {number}  p.limit       page size
 * @returns {Promise<{profiles: object[], total: number}>}
 */
const findArtisansPage = async ({ query, lat, lng, maxDistanceKm, page, limit, model = ArtisanProfile }) => {
  const skip = (page - 1) * limit;
  const userLookup = [
    { $lookup: { from: User.collection.name, localField: 'userId', foreignField: '_id', pipeline: [{ $project: { name: 1 } }], as: 'u' } },
    { $addFields: { userId: { $let: { vars: { u: { $arrayElemAt: ['$u', 0] } }, in: { _id: '$$u._id', name: '$$u.name' } } } } },
    { $project: { u: 0 } },
  ];

  // ── Without a location: everyone, best first (Pro, rating, completed jobs), stable order ──
  if (!validCoords(lat, lng)) {
    const [total, profiles] = await Promise.all([
      model.countDocuments(query),
      model.aggregate([
        { $match: query },
        { $sort: { isPro: -1, 'stats.averageRating': -1, 'stats.completedJobs': -1, _id: 1 } },
        { $skip: skip },
        { $limit: limit },
        ...userLookup,
      ]),
    ]);
    return { profiles, total };
  }

  // ── With a location: nearest band first; inside a band Pro, rating, then nearer ──
  const pipeline = [
    { $match: query },
    { $addFields: { distKm: distanceKmExpr(lat, lng) } },
    ...(maxDistanceKm ? [{ $match: { distKm: { $lte: maxDistanceKm } } }] : []),
    { $addFields: { band: bandExpr() } },
    {
      $facet: {
        items: [
          { $sort: { band: 1, isPro: -1, 'stats.averageRating': -1, distKm: 1, _id: 1 } },
          { $skip: skip },
          { $limit: limit },
          ...userLookup,
        ],
        meta: [{ $count: 'total' }],
      },
    },
  ];
  const [out] = await model.aggregate(pipeline).allowDiskUse(true);
  return { profiles: out?.items ?? [], total: out?.meta?.[0]?.total ?? 0 };
};

module.exports = { findArtisansPage, distanceKmExpr, bandExpr, BANDS_KM, UNKNOWN_KM };
