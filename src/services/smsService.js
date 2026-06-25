'use strict';

const bcrypt  = require('bcryptjs');
const OTP     = require('../models/OTP');
const bulkSms = require('./bulkSmsService');
const { sendOtpEmail, maskEmail } = require('../utils/emailService');

const OTP_EXPIRES_MINUTES = () => parseInt(process.env.OTP_EXPIRES_MINUTES) || 10;
const CONSOLE_MODE   = process.env.FORCE_CONSOLE_OTP === 'true';
const REVIEWER_PHONE = process.env.REVIEWER_PHONE || null;
const REVIEWER_OTP   = process.env.REVIEWER_OTP   || null;

// Normalize Nigerian phone to E.164 (+234...)
const normalizePhone = (phone) => {
  const cleaned = phone.replace(/\s|-|\./g, '');
  if (cleaned.startsWith('+234')) return cleaned;
  if (cleaned.startsWith('234'))  return `+${cleaned}`;
  if (cleaned.startsWith('0'))    return `+234${cleaned.slice(1)}`;
  return `+234${cleaned}`;
};

// BulkSMS Nigeria only delivers reliably 8am–6pm WAT (UTC+1)
const isOutsideBulkSmsHours = () => {
  const watHour = (new Date().getUTCHours() + 1) % 24;
  return watHour < 8 || watHour >= 18;
};

/**
 * Generate, store, and dispatch an OTP.
 * @param {string}  phone       - raw Nigerian phone number
 * @param {string}  [email]     - email address for fallback delivery
 * @param {boolean} [forceEmail=false] - skip SMS, deliver straight to email
 * @returns {{ normalized, emailUsed, maskedEmail? }}
 */
exports.sendOTP = async (phone, email = null, forceEmail = false) => {
  const normalized = normalizePhone(phone);
  const isReviewer = REVIEWER_PHONE && normalized === normalizePhone(REVIEWER_PHONE);
  const otp        = (isReviewer && REVIEWER_OTP) ? REVIEWER_OTP : bulkSms.generateAlphanumericOTP();

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

  // ── Reviewer account ─────────────────────────────────────────────────────────
  if (isReviewer) {
    return { normalized, emailUsed: false };
  }

  // ── Force email ──────────────────────────────────────────────────────────────
  if (forceEmail && email) {
    await sendOtpEmail(email, otp);
    return { normalized, emailUsed: true, maskedEmail: maskEmail(email) };
  }

  // ── Outside BulkSMS hours → email fallback ───────────────────────────────────
  if (isOutsideBulkSmsHours() && email) {
    console.log(`[OTP] Outside BulkSMS hours → email fallback → ${maskEmail(email)}`);
    await sendOtpEmail(email, otp);
    return { normalized, emailUsed: true, maskedEmail: maskEmail(email) };
  }

  // ── Standard SMS with email fallback on failure ──────────────────────────────
  try {
    await bulkSms.sendOTP(normalized, otp);
    return { normalized, emailUsed: false };
  } catch (smsErr) {
    if (email) {
      console.warn(`[OTP] BulkSMS failed (${smsErr.message}) → email fallback → ${maskEmail(email)}`);
      await sendOtpEmail(email, otp);
      return { normalized, emailUsed: true, maskedEmail: maskEmail(email) };
    }
    throw smsErr;
  }
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
