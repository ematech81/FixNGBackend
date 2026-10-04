'use strict';

const axios = require('axios');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const maskEmail = (email) => {
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
};

/**
 * Core sender — Brevo transactional HTTP API. Throws on failure.
 * Use directly only where the caller must know the email failed (e.g. OTP);
 * use sendEmailSafe for everything else.
 *
 * Sender defaults to FixNG <nwankwolivinus95@gmail.com> (the address verified in
 * Brevo); BREVO_FROM_EMAIL / BREVO_FROM_NAME / BREVO_REPLY_TO env vars override.
 * Use a real address, not noreply — spam filters penalise noreply senders.
 *
 * @param {object}   opts
 * @param {string}   opts.to
 * @param {string}   opts.subject
 * @param {string}   opts.html
 * @param {string}   opts.text
 * @param {string[]} [opts.tags]  filterable in the Brevo dashboard
 * @param {boolean}  [opts.brand] send from the domain address (BREVO_BRAND_FROM_EMAIL,
 *   default info@fixng.com.ng) instead of the OTP sender. Same Brevo account and
 *   API key — info@fixng.com.ng must stay a verified sender there. OTP never uses it.
 */
const sendEmail = async ({ to, subject, html, text, tags = [], brand = false }) => {
  const apiKey   = process.env.BREVO_API_KEY;
  const fromAddr = brand
    ? (process.env.BREVO_BRAND_FROM_EMAIL || 'info@fixng.com.ng')
    : (process.env.BREVO_FROM_EMAIL || 'nwankwolivinus95@gmail.com');
  const fromName = process.env.BREVO_FROM_NAME || 'FixNG';
  const replyTo  = brand
    ? (process.env.BREVO_BRAND_FROM_EMAIL || 'info@fixng.com.ng')
    : (process.env.BREVO_REPLY_TO || 'nwankwolivinus95@gmail.com');

  if (!apiKey) {
    console.error('[Email] BREVO_API_KEY not set');
    throw new Error('Email service not configured. Please contact support.');
  }

  try {
    await axios.post(
      BREVO_URL,
      {
        sender:      { name: fromName, email: fromAddr },
        replyTo:     { email: replyTo },
        to:          [{ email: to }],
        subject,
        textContent: text,
        htmlContent: html,
        tags:        ['transactional', ...tags],
      },
      { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
  } catch (err) {
    console.error('[Email] Brevo error:', err.response?.data || err.message);
    throw new Error('Could not send email.');
  }
};

/**
 * Fire-and-forget wrapper: never throws and never needs awaiting, so a failed
 * email can't break the request that triggered it. Sends from the domain
 * address (info@fixng.com.ng) by default; pass brand: false for the OTP sender.
 */
const sendEmailSafe = (opts) => {
  sendEmail({ brand: true, ...opts })
    .then(() => console.log(`[Email] ${opts.tags?.[0] ?? 'email'} sent to ${maskEmail(opts.to)}`))
    .catch((err) => console.error(`[Email] ${opts.tags?.[0] ?? 'email'} to ${maskEmail(opts.to)} failed: ${err.message}`));
};

const sendOtpEmail = async (email, otp) => {
  const expiry = parseInt(process.env.OTP_EXPIRES_MINUTES) || 10;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">

        <!-- Header -->
        <tr>
          <td style="background:#2563EB;padding:28px 32px">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px">FixNG</p>
            <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.75)">Nigeria's Artisan Marketplace</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px">
            <p style="margin:0 0 8px;font-size:16px;color:#111827;font-weight:600">Hi there 👋</p>
            <p style="margin:0 0 24px;font-size:15px;color:#6B7280;line-height:1.6">
              Use the verification code below to access your FixNG account. It expires in <strong>${expiry} minutes</strong>.
            </p>

            <!-- OTP box -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="background:#EFF6FF;border-radius:12px;padding:20px 16px">
                  <p style="margin:0 0 4px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:600">Your verification code</p>
                  <p style="margin:0;font-size:38px;font-weight:700;letter-spacing:12px;color:#1E3A8A;font-family:monospace">${otp}</p>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;font-size:13px;color:#9CA3AF;line-height:1.6">
              Never share this code with anyone — FixNG staff will never ask for it.<br>
              If you didn't request this, you can safely ignore this email.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:20px 32px">
            <p style="margin:0;font-size:12px;color:#9CA3AF">
              © ${new Date().getFullYear()} FixNG Artisan Marketplace · Nigeria<br>
              Questions? Reply to this email or contact <a href="mailto:info@fixng.com.ng" style="color:#2563EB;text-decoration:none">info@fixng.com.ng</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // OTP must surface failures — the caller falls back / tells the user.
  try {
    await sendEmail({
      to:      email,
      subject: `${otp} is your FixNG verification code`,
      html,
      text:    `Your FixNG verification code is: ${otp}\n\nValid for ${expiry} minutes. Never share this code with anyone.\n\nIf you didn't request this, ignore this email.\n\n© ${new Date().getFullYear()} FixNG`,
      tags:    ['otp'],
    });
    console.log(`[Email] OTP sent to ${maskEmail(email)}`);
  } catch (err) {
    if (err.message.startsWith('Email service not configured')) throw err;
    throw new Error('Could not send OTP email. Please try again.');
  }
};

module.exports = { sendEmail, sendEmailSafe, sendOtpEmail, maskEmail };
