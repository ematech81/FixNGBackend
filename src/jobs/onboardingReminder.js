'use strict';

// Automatic nudge for artisans who signed up but never finished onboarding.
// Off by default — set ONBOARDING_REMINDERS=true on Railway to turn it on.
// Each artisan gets at most 2 reminders: the first 24 h after signing up, the second
// 3 days after the first. Runs once a day at 10:00 Lagos time and never sends more than 40 per run.

const cron = require('node-cron');
const outreach = require('../services/artisanOutreach');

const FIRST_AFTER_MS  = 24 * 60 * 60 * 1000;
const REPEAT_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_REMINDERS   = 2;
const MAX_PER_RUN     = 40;

const run = async () => {
  try {
    const now = Date.now();
    const due = (await outreach.findIncomplete()).filter(({ user, profile }) => {
      const count = profile.outreach?.reminderCount || 0;
      if (count >= MAX_REMINDERS) return false;
      if (count === 0) return now - new Date(user.createdAt).getTime() >= FIRST_AFTER_MS;
      return now - new Date(profile.outreach?.lastReminderAt || 0).getTime() >= REPEAT_AFTER_MS;
    }).slice(0, MAX_PER_RUN);

    let sent = 0;
    for (const t of due) {
      try { await outreach.sendCompleteProfile(t); sent += 1; }
      catch (e) { console.error('[onboardingReminder] send failed:', e.message); }
      await new Promise((r) => setTimeout(r, 400));
    }
    console.log(`[onboardingReminder] ${sent}/${due.length} reminders sent`);
  } catch (err) {
    console.error('[onboardingReminder] error:', err.message);
  }
};

module.exports = () => {
  if (process.env.ONBOARDING_REMINDERS !== 'true') {
    console.log('[onboardingReminder] disabled (set ONBOARDING_REMINDERS=true to enable)');
    return;
  }
  cron.schedule('0 10 * * *', run, { timezone: 'Africa/Lagos' });
  console.log('[onboardingReminder] scheduled — daily at 10:00 Lagos time');
};
module.exports.run = run;
