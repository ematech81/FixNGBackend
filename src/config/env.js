'use strict';

const REQUIRED = [
  'KORAPAY_PUBLIC_KEY',
  'KORAPAY_SECRET_KEY',
  'KORAPAY_WEBHOOK_SECRET',
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[startup] Missing required env vars: ${missing.join(', ')}`);
  console.error('[startup] Server refused to start. Add the missing vars and restart.');
  process.exit(1);
}

const int = (key, fallback) => {
  const v = parseInt(process.env[key]);
  return isNaN(v) ? fallback : v;
};

module.exports = {
  korapay: {
    publicKey:     process.env.KORAPAY_PUBLIC_KEY,
    secretKey:     process.env.KORAPAY_SECRET_KEY,
    webhookSecret: process.env.KORAPAY_WEBHOOK_SECRET,
    prices: {
      monthly:   int('KORAPAY_PRICE_MONTHLY',   5000),
      quarterly: int('KORAPAY_PRICE_QUARTERLY', 13500),
      yearly:    int('KORAPAY_PRICE_YEARLY',    48000),
    },
  },
  sub: {
    trialDays:         int('SUB_TRIAL_DAYS',          7),
    graceDays:         int('SUB_GRACE_DAYS',           3),
    refundWindowHours: int('SUB_REFUND_WINDOW_HOURS', 48),
  },
};
