'use strict';
require('dotenv').config();
const mongoose       = require('mongoose');
require('../src/models/User');          // register User model for populate
const ArtisanProfile = require('../src/models/ArtisanProfile');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  // Must populate so that missing User documents resolve to null
  const all     = await ArtisanProfile.find({ isPro: true }).populate('userId', '_id name').lean();
  const orphans = all.filter((p) => !p.userId); // null after populate = user document deleted
  console.log('Orphaned Pro profiles found:', orphans.length);
  if (orphans.length > 0) {
    const ids    = orphans.map((p) => p._id);
    const result = await ArtisanProfile.updateMany(
      { _id: { $in: ids } },
      { $set: { isPro: false, proSource: null } }
    );
    console.log('Cleaned:', result.modifiedCount);
  }
  await mongoose.disconnect();
  console.log('Done');
}).catch((e) => { console.error(e.message); process.exit(1); });
