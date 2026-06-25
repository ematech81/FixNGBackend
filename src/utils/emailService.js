'use strict';

const axios = require('axios');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const maskEmail = (email) => {
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
};

const sendOtpEmail = async (email, otp) => {
  const apiKey   = process.env.BREVO_API_KEY;
  const fromAddr = process.env.BREVO_FROM_EMAIL || 'noreply@fixng.app';
  const fromName = process.env.BREVO_FROM_NAME  || 'FixNG';
  const expiry   = parseInt(process.env.OTP_EXPIRES_MINUTES) || 10;

  if (!apiKey) {
    console.error('[Email] BREVO_API_KEY not set');
    throw new Error('Email service not configured. Please contact support.');
  }

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#2563EB;margin-bottom:8px">FixNG Access Key</h2>
      <p style="color:#6B7280">Your one-time access key is:</p>
      <div style="font-size:36px;font-weight:700;letter-spacing:10px;text-align:center;
                  margin:24px 0;background:#EFF6FF;padding:16px;border-radius:12px;
                  color:#1E3A8A">${otp}</div>
      <p style="color:#6B7280">Valid for <strong>${expiry} minutes</strong>. Keep it private.</p>
      <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0"/>
      <p style="color:#9CA3AF;font-size:12px">If you did not request this, please ignore this email.</p>
    </div>`;

  try {
    await axios.post(
      BREVO_URL,
      {
        sender:      { name: fromName, email: fromAddr },
        to:          [{ email }],
        subject:     'Your FixNG Access Key',
        textContent: `Your FixNG access key is: ${otp}\n\nValid for ${expiry} minutes. Keep it private.`,
        htmlContent: html,
      },
      { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    console.log(`[Email] OTP sent to ${maskEmail(email)}`);
  } catch (err) {
    console.error('[Email] Brevo error:', err.response?.data || err.message);
    throw new Error('Could not send OTP email. Please try again.');
  }
};

module.exports = { sendOtpEmail, maskEmail };
