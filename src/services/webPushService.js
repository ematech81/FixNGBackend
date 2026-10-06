'use strict';

// Browser (Web Push) notifications for users on the website. The Expo push in
// pushService.js only reaches the mobile app. Disabled (no-op) until the VAPID
// keys are set in the environment.

const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

const PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const enabled     = !!(PUBLIC_KEY && PRIVATE_KEY);

if (enabled) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@fixng.com.ng', PUBLIC_KEY, PRIVATE_KEY);
} else {
  console.warn('[webPush] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — web push disabled');
}

const isEnabled    = () => enabled;
const getPublicKey = () => (enabled ? PUBLIC_KEY : null);

/**
 * Send a web push to every browser the user subscribed. Never throws.
 * Subscriptions the push service reports as gone (404/410) are deleted.
 *
 * @param {string|ObjectId} userId
 * @param {{title:string, body:string, url?:string, tag?:string, type?:string}} payload
 */
const sendWebPush = async (userId, payload) => {
  if (!enabled) return;
  try {
    const subs = await PushSubscription.find({ userId }).lean();
    if (subs.length === 0) return;

    const body = JSON.stringify(payload);
    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: s.keys },
            body,
            { TTL: 60 * 60 * 24, urgency: 'high' }
          );
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await PushSubscription.deleteOne({ _id: s._id }).catch(() => {});
          } else {
            console.warn('[webPush] send failed:', err.statusCode || err.message);
          }
        }
      })
    );
  } catch (err) {
    console.warn('[webPush] sendWebPush error:', err.message);
  }
};

module.exports = { isEnabled, getPublicKey, sendWebPush };
