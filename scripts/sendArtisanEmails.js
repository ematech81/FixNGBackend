'use strict';

// Outreach emails to artisans, from info@fixng.com.ng.
//
//   node scripts/sendArtisanEmails.js --audience=incomplete            DRY RUN: who would get "finish your profile"
//   node scripts/sendArtisanEmails.js --audience=verified              DRY RUN: who would get the official welcome
//   node scripts/sendArtisanEmails.js --preview=./email-previews       write both emails as HTML files to open in a browser
//   node scripts/sendArtisanEmails.js --audience=incomplete --send     actually send
//   node scripts/sendArtisanEmails.js --audience=verified --send --limit=5   send to only the first 5
//
// Safe to re-run: the welcome is recorded per artisan (never sent twice), and reminders are counted.
// Only artisans with an email are included. Dry run prints masked emails, never full ones.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const outreach = require('../src/services/artisanOutreach');
const { maskEmail } = require('../src/utils/emailService');

const arg = (name) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const writePreviews = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const samples = [
    ['1-finish-your-profile.html', 'artisan_complete_profile', { name: 'Ada Obi', missing: ['Choose your skills and write a short bio', 'Set your location', 'Upload your ID and a short skill video (you can skip these two)'] }],
    ['2-official-welcome.html', 'artisan_welcome_onboarding', { name: 'Ada Obi' }],
  ];
  for (const [file, template, vars] of samples) {
    const { subject, html } = outreach.build(template, vars);
    fs.writeFileSync(path.join(dir, file), `<!-- Subject: ${subject} -->\n${html}`);
    console.log(`wrote ${path.join(dir, file)}   (subject: ${subject})`);
  }
};

(async () => {
  if (arg('preview')) {
    // Needs no database
    writePreviews(path.resolve(String(arg('preview'))));
    return;
  }

  const audience = arg('audience');
  if (!['incomplete', 'verified'].includes(audience)) {
    console.log('Usage: --audience=incomplete|verified  [--send] [--limit=N]   or   --preview=<folder>');
    process.exit(1);
  }
  const SEND = arg('send') === true;
  const limit = parseInt(arg('limit'), 10) || Infinity;

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  let targets = audience === 'incomplete' ? await outreach.findIncomplete() : await outreach.findVerifiedNotWelcomed();
  const total = targets.length;
  targets = targets.slice(0, limit);

  console.log(`${SEND ? 'SENDING' : 'DRY RUN'} — audience: ${audience} — ${total} artisans with an email${total > targets.length ? `, limited to ${targets.length}` : ''}`);
  console.log(audience === 'incomplete'
    ? 'Email: "Finish setting up your FixNG profile" (lists what each person still has to do)'
    : 'Email: "Welcome to FixNG — you\'re officially on board" (app is at onboarding stage)');

  let sent = 0; let failed = 0;
  for (const t of targets) {
    const detail = audience === 'incomplete' ? `  missing ${outreach.missingSteps(t.profile).length} step(s), reminders so far: ${t.profile.outreach?.reminderCount || 0}` : '';
    if (!SEND) { console.log(`  would send to ${maskEmail(t.user.email)}${detail}`); continue; }
    try {
      if (audience === 'incomplete') await outreach.sendCompleteProfile(t); else await outreach.sendWelcome(t);
      sent += 1;
      console.log(`  sent    ${maskEmail(t.user.email)}`);
    } catch (e) {
      failed += 1;
      console.log(`  FAILED  ${maskEmail(t.user.email)}  (${e.message})`);
    }
    await sleep(400); // gentle pacing
  }

  console.log(SEND ? `\nDone: ${sent} sent, ${failed} failed.` : '\nDry run only — nothing was sent. Add --send to send.');
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
