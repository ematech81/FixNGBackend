'use strict';

// SMS alert to an artisan who was booked directly. Used while the mobile app (with
// push) isn't available. Guardrails, because every SMS costs wallet credit:
//   • daytime only (08:00–20:00 Lagos) — BulkSMS holds night messages until morning,
//     so a late alert would just arrive stale
//   • at most one SMS per artisan per 10 minutes
//   • off switch:  JOB_ALERT_SMS=false
// Fire-and-forget: never throws, never blocks the booking request.

const User = require('../models/User');
const bulkSms = require('../services/bulkSmsService');

const WINDOW_START_HOUR = 8;
const WINDOW_END_HOUR   = 20;
const THROTTLE_MS       = 10 * 60 * 1000;

const lastSent = new Map(); // artisanUserId -> timestamp

const lagosHour = () =>
  parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: 'numeric', hourCycle: 'h23' }).format(new Date()), 10);

const inDaytimeWindow = () => {
  const h = lagosHour();
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
};

const smsDirectJobAlert = (artisanUserId, { category } = {}) => {
  (async () => {
    if (process.env.JOB_ALERT_SMS === 'false') return;
    if (!inDaytimeWindow()) return console.log('[jobAlertSms] outside daytime window — skipped');

    const key = String(artisanUserId);
    if (Date.now() - (lastSent.get(key) || 0) < THROTTLE_MS) return;

    const user = await User.findById(artisanUserId).select('phone').lean();
    if (!user?.phone) return;

    lastSent.set(key, Date.now());
    await bulkSms.sendText(
      user.phone,
      `FixNG: You have a new ${category || 'job'} request from a customer. Log in at fixng.com.ng to view and respond.`
    );
    console.log('[jobAlertSms] sent to artisan', key);
  })().catch((err) => console.error('[jobAlertSms] failed:', err.message));
};

module.exports = { smsDirectJobAlert, inDaytimeWindow };
