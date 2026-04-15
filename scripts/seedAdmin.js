/**
 * seedAdmin.js — Run once to create your admin account.
 *
 * Usage:
 *   node scripts/seedAdmin.js
 *
 * Fill in YOUR details in the CONFIG block below before running.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');

// ─── FILL IN YOUR DETAILS HERE ───────────────────────────────────────────────
const CONFIG = {
  name:  'Emmanuel',        // e.g. 'Sani Admin'
  phone: '+2348068745098',        // your Nigerian phone number in international format
};
// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅  Connected to MongoDB');

  const existing = await User.findOne({ phone: CONFIG.phone });

  if (existing) {
    if (existing.role === 'admin') {
      console.log('ℹ️   Admin account already exists for this phone. Nothing changed.');
    } else {
      // Upgrade existing account to admin
      existing.role = 'admin';
      await existing.save();
      console.log(`✅  Upgraded existing account (${existing.name}) to role: admin`);
    }
  } else {
    await User.create({
      name: CONFIG.name,
      phone: CONFIG.phone,
      role: 'admin',
      authMethod: 'phone',
      isPhoneVerified: true,
      isActive: true,
    });
    console.log(`✅  Admin account created for ${CONFIG.name} (${CONFIG.phone})`);
  }

  console.log('\n📱  How to log in:');
  console.log('    1. Open FixNG app and enter your phone number');
  console.log('    2. Since FORCE_CONSOLE_OTP=true, the OTP will print in this terminal');
  console.log('    3. Enter the OTP — you will be routed to the Admin Dashboard\n');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
