// NOTE: expo-server-sdk must be installed before using this utility.
// Run: npm install expo-server-sdk
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

async function sendPushNotification(expoPushToken, { title, body, data = {} }) {
  if (!Expo.isExpoPushToken(expoPushToken)) return;
  try {
    await expo.sendPushNotificationsAsync([{
      to: expoPushToken,
      sound: 'default',
      title,
      body,
      data,
    }]);
  } catch {
    // silent — push delivery is best-effort
  }
}

module.exports = { sendPushNotification };
