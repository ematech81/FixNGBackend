'use strict';

// Outreach emails to artisans: "finish your profile" reminders and the official welcome.
// Used by scripts/sendArtisanEmails.js (one-off sends) and jobs/onboardingReminder.js (automatic).
// Sends through Brevo from info@fixng.com.ng, one at a time, and records what was sent on the
// profile so nobody is emailed twice.

const User = require('../models/User');
const ArtisanProfile = require('../models/ArtisanProfile');
const { sendEmail } = require('../utils/emailService');
const { TEMPLATES, render } = require('../utils/emailNotifications');

/** What this artisan still has to do before customers can see them. */
const missingSteps = (profile) => {
  const s = profile.completedSteps || {};
  const skipped = profile.skippedSteps || {};
  const missing = [];
  if (!s.profilePhoto) missing.push('Add a profile photo');
  if (!s.skills)       missing.push('Choose your skills and write a short bio');
  if (!s.location)     missing.push('Set your location');
  if (!(s.verificationId || skipped.verificationId) || !(s.skillVideo || skipped.skillVideo)) {
    missing.push('Upload your ID and a short skill video (you can skip these two)');
  }
  return missing;
};

/** Artisans (with an email) who started signing up but haven't finished. */
const findIncomplete = async () => {
  const profiles = await ArtisanProfile.find({ onboardingComplete: { $ne: true }, verificationStatus: { $ne: 'verified' } })
    .select('userId completedSteps skippedSteps outreach').lean();
  const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) }, isActive: { $ne: false }, email: { $ne: null } })
    .select('name email createdAt').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return profiles
    .map((p) => ({ user: byId.get(String(p.userId)), profile: p }))
    .filter((x) => x.user);
};

/** Verified artisans (with an email) who haven't had the welcome email yet. */
const findVerifiedNotWelcomed = async () => {
  const profiles = await ArtisanProfile.find({ verificationStatus: 'verified', 'outreach.welcomeSentAt': null })
    .select('userId outreach').lean();
  const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) }, isActive: { $ne: false }, email: { $ne: null } })
    .select('name email').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return profiles
    .map((p) => ({ user: byId.get(String(p.userId)), profile: p }))
    .filter((x) => x.user);
};

const build = (template, vars) => {
  const { subject, heading, paragraphs, cta } = TEMPLATES[template](vars);
  return { subject, ...render({ heading, paragraphs, cta }) };
};

const deliver = async (user, template, vars) => {
  const { subject, html, text } = build(template, { name: user.name, ...vars });
  await sendEmail({ to: user.email, subject, html, text, tags: [template], brand: true });
};

/** Send the "finish your profile" email and record it. Throws if the send fails. */
const sendCompleteProfile = async ({ user, profile }) => {
  await deliver(user, 'artisan_complete_profile', { missing: missingSteps(profile) });
  await ArtisanProfile.updateOne(
    { _id: profile._id },
    { $inc: { 'outreach.reminderCount': 1 }, $set: { 'outreach.lastReminderAt': new Date() } }
  );
};

/** Send the official welcome email and record it. Throws if the send fails. */
const sendWelcome = async ({ user, profile }) => {
  await deliver(user, 'artisan_welcome_onboarding', {});
  await ArtisanProfile.updateOne({ _id: profile._id }, { $set: { 'outreach.welcomeSentAt': new Date() } });
};

module.exports = { missingSteps, findIncomplete, findVerifiedNotWelcomed, build, sendCompleteProfile, sendWelcome };
