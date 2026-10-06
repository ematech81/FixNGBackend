'use strict';

// Transactional (non-OTP) emails. Every send is fire-and-forget and only happens
// when the user has an email on file — most FixNG users are phone-only.
// Usage:  emailUser(userId, 'job_accepted', { artisanName, category });

const User = require('../models/User');
const { sendEmailSafe } = require('./emailService');

const SITE_URL = 'https://www.fixng.com.ng';

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const firstName = (name) => (name || '').trim().split(/\s+/)[0] || 'there';

// ── Shared layout ─────────────────────────────────────────────────────────────
// paragraphs: plain strings (escaped here); cta: { label, url } optional.
const render = ({ heading, paragraphs, cta }) => {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;color:#4B5563;line-height:1.6">${esc(p)}</p>`)
    .join('');

  const button = cta
    ? `<table cellpadding="0" cellspacing="0" style="margin:8px 0 0"><tr><td style="background:#2563EB;border-radius:10px">
         <a href="${esc(cta.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none">${esc(cta.label)}</a>
       </td></tr></table>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 12px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
        <tr>
          <td style="background:#2563EB;padding:24px 32px">
            <a href="${SITE_URL}" style="text-decoration:none"><span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px">FixNG</span></a>
            <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.75)">Nigeria's Artisan Marketplace</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px">
            <h1 style="margin:0 0 16px;font-size:20px;color:#111827">${esc(heading)}</h1>
            ${body}
            ${button}
          </td>
        </tr>
        <tr>
          <td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:20px 32px">
            <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.6">
              © ${new Date().getFullYear()} FixNG Artisan Marketplace · Nigeria<br>
              Questions? Reply to this email or write to <a href="mailto:info@fixng.com.ng" style="color:#2563EB;text-decoration:none">info@fixng.com.ng</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    heading,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...(cta ? [`${cta.label}: ${cta.url}`, ''] : []),
    `© ${new Date().getFullYear()} FixNG · Questions? Reply to this email or write to info@fixng.com.ng`,
  ].join('\n');

  return { html, text };
};

// ── Templates ─────────────────────────────────────────────────────────────────
// Each returns { subject, heading, paragraphs, cta? }.
const TEMPLATES = {
  welcome: ({ name, role }) => ({
    subject: 'Welcome to FixNG',
    heading: `Welcome to FixNG, ${firstName(name)}!`,
    paragraphs: role === 'artisan'
      ? [
          'Your artisan account is ready. Complete your profile — photo, skills and location — so customers near you can find and book you.',
        ]
      : [
          'Your account is ready. Find verified artisans and professionals near you — plumbers, electricians, lawyers, engineers and more.',
        ],
    cta: { label: 'Open FixNG', url: SITE_URL },
  }),

  artisan_verified: ({ name }) => ({
    subject: 'Your FixNG profile is verified',
    heading: 'Your profile is verified',
    paragraphs: [
      `Congratulations ${firstName(name)}! Your FixNG profile has been verified. You can now receive job requests.`,
    ],
    cta: { label: 'Open FixNG', url: SITE_URL },
  }),

  artisan_rejected: ({ name, reason }) => ({
    subject: 'Your FixNG profile needs changes',
    heading: 'Your profile was not approved',
    paragraphs: [
      `Hi ${firstName(name)}, we could not approve your profile yet.`,
      `Reason: ${reason}`,
      'Please update your profile and resubmit. If you have questions, just reply to this email.',
    ],
    cta: { label: 'Update my profile', url: SITE_URL },
  }),

  account_warning: ({ name, reason, warningCount }) => ({
    subject: `FixNG account warning${warningCount ? ` #${warningCount}` : ''}`,
    heading: `Account warning${warningCount ? ` #${warningCount}` : ''}`,
    paragraphs: [
      `Hi ${firstName(name)}, your FixNG account has received a warning.`,
      `Reason: ${reason}`,
      'Repeated violations can lead to suspension. If you think this is a mistake, reply to this email.',
    ],
  }),

  account_suspended: ({ name, reason }) => ({
    subject: 'Your FixNG account has been suspended',
    heading: 'Your account has been suspended',
    paragraphs: [
      `Hi ${firstName(name)}, your FixNG account has been suspended.`,
      `Reason: ${reason}`,
      'To appeal, reply to this email and our team will review it.',
    ],
  }),

  job_request: ({ name, category, description, location, isDirect }) => ({
    subject: isDirect ? 'New direct job request on FixNG' : 'New job request on FixNG',
    heading: isDirect ? 'You have a new direct job request' : 'You have a new job request',
    paragraphs: [
      `Hi ${firstName(name)}, a customer needs a ${category} job done${location ? ` in ${location}` : ''}.`,
      ...(description ? [`“${description}”`] : []),
      'Open FixNG to view the details and respond quickly — other artisans may be notified too.',
    ],
    cta: { label: 'View job', url: SITE_URL },
  }),

  // Broadcast job to nearby artisans (sent from notify(); low priority + throttled)
  job_broadcast: ({ name, body, jobId }) => ({
    subject: 'New job near you on FixNG',
    heading: 'A new job near you',
    paragraphs: [
      `Hi ${firstName(name)}, a customer near you needs help.`,
      body,
      'Other artisans were alerted too — the first to respond usually gets the job.',
    ],
    cta: { label: 'View available jobs', url: `${SITE_URL}/artisan/jobs/available` },
  }),

  // New chat message (sent from notify(); low priority + throttled)
  new_message: ({ name, role, body, jobId, senderName }) => ({
    subject: `New message${senderName ? ` from ${senderName}` : ''} on FixNG`,
    heading: 'You have a new message',
    paragraphs: [
      `Hi ${firstName(name)}, ${senderName || 'someone'} sent you a message on FixNG:`,
      `“${body}”`,
    ],
    cta: {
      label: 'Reply on FixNG',
      url: `${SITE_URL}/${role === 'artisan' ? 'artisan' : 'customer'}/messages${jobId ? `/${jobId}` : ''}`,
    },
  }),

  job_accepted: ({ name, artisanName, category, eta }) => ({
    subject: 'An artisan accepted your FixNG job',
    heading: 'Your job was accepted',
    paragraphs: [
      `Hi ${firstName(name)}, ${artisanName || 'an artisan'} has accepted your ${category} request.${eta ? ` Estimated arrival: ${eta} minutes.` : ''}`,
      'Open FixNG to chat with them and follow the job.',
    ],
    cta: { label: 'View job', url: SITE_URL },
  }),
};

// ── Throttle + daily cap for high-frequency emails ───────────────────────────
// In-memory (per server process): resets on restart, which is acceptable for
// rate-limiting. Low-priority emails (broadcast jobs, chat messages) can never use
// more than EMAIL_LOW_PRIORITY_DAILY_CAP of Brevo's free 300/day, so OTP, welcome
// and booking emails always have room.
const lastSent = new Map();            // `${userId}:${template}` -> timestamp
let lowCount = 0;
let lowCountDay = '';

const lagosDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
const lowPriorityCap = () => parseInt(process.env.EMAIL_LOW_PRIORITY_DAILY_CAP, 10) || 150;

const allowLowPriority = () => {
  const today = lagosDay();
  if (today !== lowCountDay) { lowCountDay = today; lowCount = 0; }
  return lowCount < lowPriorityCap();
};

/**
 * Email a user about an event. Never throws, never needs awaiting, and does
 * nothing for users without an email — safe to call from any request handler.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.throttleMs]   skip if this user got this template within the window
 * @param {boolean} [opts.lowPriority]  counts against the low-priority daily cap
 */
const emailUser = (userId, template, vars = {}, opts = {}) => {
  (async () => {
    const build = TEMPLATES[template];
    if (!build) return console.error(`[Email] unknown template: ${template}`);

    const throttleKey = `${userId}:${template}`;
    if (opts.throttleMs && Date.now() - (lastSent.get(throttleKey) || 0) < opts.throttleMs) return;
    if (opts.lowPriority && !allowLowPriority()) {
      return console.warn(`[Email] low-priority daily cap reached — skipped ${template}`);
    }

    const user = await User.findById(userId).select('name email role').lean();
    if (!user?.email) return;

    if (opts.throttleMs) lastSent.set(throttleKey, Date.now());
    if (opts.lowPriority) lowCount += 1;

    const { subject, heading, paragraphs, cta } = build({ name: user.name, role: user.role, ...vars });
    const { html, text } = render({ heading, paragraphs, cta });
    sendEmailSafe({ to: user.email, subject, html, text, tags: [template] });
  })().catch((err) => console.error(`[Email] ${template} failed before send:`, err.message));
};

module.exports = { emailUser, TEMPLATES, render };
