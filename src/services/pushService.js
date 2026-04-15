const axios = require('axios');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send a push notification to a single Expo push token.
 * Non-critical — logs errors but never throws.
 *
 * @param {string} expoPushToken  - e.g. "ExponentPushToken[xxxx]"
 * @param {string} title
 * @param {string} body
 * @param {object} data           - extra payload (jobId, type, etc.)
 */
const sendPush = async (expoPushToken, title, body, data = {}) => {
  if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken')) return;

  try {
    await axios.post(
      EXPO_PUSH_URL,
      {
        to:       expoPushToken,
        sound:    'default',
        title,
        body,
        data,
        priority: 'high',
        channelId: 'default', // required for Android
      },
      {
        headers: {
          Accept:           'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type':   'application/json',
        },
        timeout: 8000,
      }
    );
  } catch (err) {
    console.error('sendPush failed:', err.message);
  }
};

/**
 * Send a push notification to multiple tokens (batch, up to 100).
 */
const sendPushBatch = async (tokens, title, body, data = {}) => {
  const valid = (tokens || []).filter(
    (t) => t && t.startsWith('ExponentPushToken')
  );
  if (valid.length === 0) return;

  const messages = valid.map((to) => ({
    to, sound: 'default', title, body, data, priority: 'high', channelId: 'default',
  }));

  // Expo recommends batches of ≤100
  const chunks = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  try {
    await Promise.all(
      chunks.map((chunk) =>
        axios.post(EXPO_PUSH_URL, chunk, {
          headers: {
            Accept:           'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type':   'application/json',
          },
          timeout: 10000,
        })
      )
    );
  } catch (err) {
    console.error('sendPushBatch failed:', err.message);
  }
};

module.exports = { sendPush, sendPushBatch };
