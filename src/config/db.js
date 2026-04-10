const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Drop the stale non-sparse email_1 unique index if it still exists.
    // We removed the unique constraint from the schema, so this index is no longer needed.
    try {
      await conn.connection.collection('users').dropIndex('email_1');
      console.log('Dropped stale email_1 index');
    } catch {
      // Index doesn't exist — that's fine
    }
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
