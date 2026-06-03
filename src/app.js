require('dotenv').config();
require('./config/env');   // fail-fast validation of Kora Pay env vars

const http    = require('http');
const express = require('express');
const connectDB   = require('./config/db');
const { initSocket } = require('./socket');

const app    = express();
const server = http.createServer(app);

// Trust Railway's reverse proxy so express-rate-limit can read the real
// client IP from X-Forwarded-For instead of throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
app.set('trust proxy', 1);

// Connect to MongoDB
connectDB();

// Init Socket.io
initSocket(server);

// ── CRITICAL: Kora Pay webhook needs raw body for HMAC signature verification.
// Mount it with express.raw() BEFORE the global express.json() parser.
// Flutterwave webhook is exempt below and is NOT affected by this order.
const KORAPAY_WEBHOOK_PATH = '/api/webhooks/korapay';
app.post(
  KORAPAY_WEBHOOK_PATH,
  express.raw({ type: 'application/json' }),
  require('./routes/webhooks')
);

// ── x-app-key guard ───────────────────────────────────────────────────────────
const EXEMPT_PATHS = [
  '/api/subscriptions/webhook',   // Flutterwave legacy — verif-hash auth
  KORAPAY_WEBHOOK_PATH,           // Kora Pay — HMAC auth
  '/api/health',
];
app.use((req, res, next) => {
  if (EXEMPT_PATHS.includes(req.path)) return next();
  const key = req.headers['x-app-key'];
  if (!key || key !== process.env.APP_KEY) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
});

// ── Global body parsers (after raw webhook) ───────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/artisan',       require('./routes/artisan'));
app.use('/api/jobs',          require('./routes/jobs'));
app.use('/api/artisans',      require('./routes/artisans'));
app.use('/api/chat',          require('./routes/chat'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/reviews',       require('./routes/reviews'));
// Note: /api/webhooks/korapay is already mounted above with raw body parsing

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.status(200).json({ success: true, message: 'FixNG API is running.' });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || 'Server error.' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`FixNG server running on port ${PORT}`);
  // Start subscription lifecycle tick job
  require('./jobs/subscriptionTick')();
});

module.exports = app;
