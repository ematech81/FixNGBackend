const https = require('https');

const EXPO_PUSH_URL = 'exp.host';
const EXPO_PUSH_PATH = '/--/api/v2/push/send';

function isExpoPushToken(token) {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(token);
}

async function sendPushNotification(expoPushToken, { title, body, data = {} }) {
  if (!isExpoPushToken(expoPushToken)) return;

  const payload = JSON.stringify({
    to: expoPushToken,
    sound: 'default',
    title,
    body,
    data,
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: EXPO_PUSH_URL,
        path: EXPO_PUSH_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
      },
      (res) => {
        res.resume();
        resolve();
      }
    );
    req.on('error', () => resolve());
    req.write(payload);
    req.end();
  });
}

module.exports = { sendPushNotification };
