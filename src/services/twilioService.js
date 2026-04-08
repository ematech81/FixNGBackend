const bcrypt = require('bcryptjs');
const OTP = require('../models/OTP');

const OTP_EXPIRES_MINUTES = 10;
const CONSOLE_MODE = process.env.FORCE_CONSOLE_OTP === 'true';

// Generate a random 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Normalize Nigerian phone to E.164 (+234...)
const normalizePhone = (phone) => {
  const cleaned = phone.replace(/\s|-|\./g, '');
  if (cleaned.startsWith('+234')) return cleaned;
  if (cleaned.startsWith('234')) return `+${cleaned}`;
  if (cleaned.startsWith('0')) return `+234${cleaned.slice(1)}`;
  return `+234${cleaned}`;
};

// Send OTP — uses Twilio in production, logs to console in dev mode
exports.sendOTP = async (phone) => {
  const normalized = normalizePhone(phone);
  const otp = generateOTP();

  // Hash before storing — raw OTP is never persisted
  const salt = await bcrypt.genSalt(10);
  const otpHash = await bcrypt.hash(otp, salt);

  const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);

  // Replace any existing OTP for this phone
  await OTP.findOneAndDelete({ phone: normalized });
  await OTP.create({ phone: normalized, otpHash, expiresAt });

  if (CONSOLE_MODE) {
    // ── DEV MODE — log OTP to console instead of sending SMS ──────────────────
    console.log('\n================================================');
    console.log('  📱 OTP (CONSOLE MODE — not sent via SMS)');
    console.log(`  Phone  : ${normalized}`);
    console.log(`  Code   : ${otp}`);
    console.log(`  Expires: ${OTP_EXPIRES_MINUTES} minutes`);
    console.log('================================================\n');
  } else {
    // ── PRODUCTION — send via Twilio ──────────────────────────────────────────
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!fromPhone) {
      throw new Error('TWILIO_PHONE_NUMBER is not set in .env');
    }

    await client.messages.create({
      body: `Your FixNG verification code is: ${otp}\n\nValid for ${OTP_EXPIRES_MINUTES} minutes. Do not share this code.`,
      from: fromPhone,
      to: normalized,
    });
  }

  return { normalized };
};

// Verify OTP — returns { valid, normalized } or { valid: false, reason }
exports.verifyOTP = async (phone, otp) => {
  const normalized = normalizePhone(phone);

  const record = await OTP.findOne({ phone: normalized, verified: false });

  if (!record) {
    return { valid: false, reason: 'No OTP found. Please request a new one.' };
  }

  if (record.expiresAt < new Date()) {
    await record.deleteOne();
    return { valid: false, reason: 'OTP has expired. Please request a new one.' };
  }

  if (record.attempts >= 5) {
    await record.deleteOne();
    return { valid: false, reason: 'Too many failed attempts. Please request a new OTP.' };
  }

  const match = await bcrypt.compare(otp, record.otpHash);

  if (!match) {
    record.attempts += 1;
    await record.save();
    const remaining = 5 - record.attempts;
    return {
      valid: false,
      reason: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
    };
  }

  await record.deleteOne();
  return { valid: true, normalized };
};

exports.normalizePhone = normalizePhone;
