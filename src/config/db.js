const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Drop stale indexes left over from old schema versions
    const drops = [
      { collection: 'users',         index: 'email_1'  },
      { collection: 'subscriptions', index: 'userId_1' }, // old field; new schema uses artisanId
    ];
    for (const { collection, index } of drops) {
      try {
        await conn.connection.collection(collection).dropIndex(index);
        console.log(`Dropped stale ${index} index on ${collection}`);
      } catch {
        // Index doesn't exist — that's fine
      }
    }

    // Migrate old subscription documents: copy userId → artisanId for any
    // document written before the Kora Pay migration that still uses the old field name.
    try {
      const result = await conn.connection.collection('subscriptions').updateMany(
        { userId: { $exists: true }, artisanId: { $exists: false } },
        [{ $set: { artisanId: '$userId' } }]
      );
      if (result.modifiedCount > 0) {
        console.log(`Migrated ${result.modifiedCount} subscription(s): userId → artisanId`);
      }
    } catch (err) {
      console.error('Subscription migration error:', err.message);
    }
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
