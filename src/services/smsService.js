'use strict';

const bcrypt  = require('bcryptjs');
const OTP     = require('../models/OTP');
const bulkSms = require('./bulkSmsService');
const { sendOtpEmail, maskEmail } = require('../utils/emailService');

const OTP_EXPIRES_MINUTES = () => parseInt(process.env.OTP_EXPIRES_MINUTES) || 10;
const CONSOLE_MODE = process.env.FORCE_CONSOLE_OTP === 'true';

// Normalize Nigerian phone to E.164 (+234...)
const normalizePhone = (phone) => {
  const cleaned = phone.replace(/\s|-|\./g, '');
  if (cleaned.startsWith('+234')) return cleaned;
  if (cleaned.startsWith('234'))  return `+${cleaned}`;
  if (cleaned.startsWith('0'))    return `+234${cleaned.slice(1)}`;
  return `+234${cleaned}`;
};

// ── Static-OTP registry ──────────────────────────────────────────────────────
// Phones in this map bypass SMS/email entirely and use a fixed OTP code.
// Add pairs via env vars: REVIEWER_PHONE/REVIEWER_OTP, ADMIN_PHONE/ADMIN_OTP
// The fixed code is hashed before storage — never persisted in plain text.
const STATIC_OTP_MAP = new Map();
[
  [process.env.REVIEWER_PHONE, process.env.REVIEWER_OTP],  // Play Store reviewer
  [process.env.ADMIN_PHONE,    process.env.ADMIN_OTP],     // Permanent admin login
].forEach(([phone, otp]) => {
  if (phone && otp) STATIC_OTP_MAP.set(normalizePhone(phone), otp);
});

/**
 * Generate, store, and dispatch an OTP.
 * SMS is always attempted first — BulkSMS Nigeria queues messages when
 * network delivery windows are closed, so no proactive hour-blocking needed.
 * If SMS fails, falls back to email. If no email available and SMS fails, throws.
 *
 * @param {string}  phone       - raw Nigerian phone number
 * @param {string}  [email]     - email address for fallback delivery
 * @param {boolean} [forceEmail=false] - skip SMS, deliver straight to email
 * @returns {{ normalized, emailUsed, maskedEmail? }}
 */
exports.sendOTP = async (phone, email = null, forceEmail = false) => {
  const normalized = normalizePhone(phone);
  const staticOtp  = STATIC_OTP_MAP.get(normalized); // defined → static phone
  const otp        = staticOtp ?? bulkSms.generateAlphanumericOTP();

  // Hash before storing — raw OTP is never persisted
  const salt    = await bcrypt.genSalt(10);
  const otpHash = await bcrypt.hash(otp, salt);
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES() * 60 * 1000);

  await OTP.findOneAndDelete({ phone: normalized });
  await OTP.create({ phone: normalized, otpHash, expiresAt });

  // ── Console / dev mode ───────────────────────────────────────────────────────
  if (CONSOLE_MODE) {
    console.log('\n================================================');
    console.log('  📱 OTP (CONSOLE MODE — not sent)');
    console.log(`  Phone  : ${normalized}`);
    console.log(`  Code   : ${otp}`);
    console.log('================================================\n');
    return { normalized, emailUsed: false };
  }

  // ── Static-OTP phone (reviewer / admin) ─────────────────────────────────────
  // Fixed code is stored (hashed). No SMS or email is sent.
  // User enters the known code on the OTP screen.
  if (staticOtp) {
    console.log(`[OTP] Static code issued for ${normalized} — no SMS sent`);
    return { normalized, emailUsed: false };
  }

  // ── Force email ──────────────────────────────────────────────────────────────
  if (forceEmail && email) {
    await sendOtpEmail(email, otp);
    return { normalized, smsSent: false, emailUsed: true, maskedEmail: maskEmail(email) };
  }

  // ── SMS and email together ───────────────────────────────────────────────────
  // BulkSMS's route accepts messages at any hour but HOLDS them ("Scheduled")
  // until the carrier window reopens (~8 pm–8 am), so an accepted API call does
  // not mean the code arrives in time. When the user has an email, send both
  // channels in parallel; the OTP works if either one succeeds.
  const [smsResult, emailResult] = await Promise.allSettled([
    bulkSms.sendOTP(normalized, otp),
    email ? sendOtpEmail(email, otp) : Promise.reject(new Error('no email')),
  ]);
  const smsSent   = smsResult.status === 'fulfilled';
  const emailSent = emailResult.status === 'fulfilled';

  if (smsSent) console.log(`[OTP] SMS sent to ${normalized}`);
  else console.warn(`[OTP] BulkSMS failed (${smsResult.reason?.message})`);
  if (email && !emailSent) console.warn(`[OTP] Email failed (${emailResult.reason?.message})`);

  if (!smsSent && !emailSent) {
    throw new Error(
      email
        ? 'Could not send your access key. Please try again, or contact support.'
        : 'Could not send your access key. Please add an email address and try again, or contact support.'
    );
  }

  // emailUsed = the code went to the email (alone or alongside SMS); smsSent tells clients which.
  return {
    normalized,
    smsSent,
    emailUsed: emailSent,
    ...(emailSent ? { maskedEmail: maskEmail(email) } : {}),
  };
};

// Verify OTP — returns { valid, normalized } or { valid: false, reason }
exports.verifyOTP = async (phone, otp) => {
  const normalized = normalizePhone(phone);
  const record     = await OTP.findOne({ phone: normalized, verified: false });

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
