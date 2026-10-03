'use strict';

// Single source of truth for browser origins allowed by CORS (and Socket.io).
// WEB_ORIGIN supports comma-separated values for extra origins, e.g:
// WEB_ORIGIN=https://staging.fixng.com.ng,https://admin.fixng.com.ng
const DEFAULT_ORIGINS = [
  'https://www.fixng.com.ng',
  'https://fixng.com.ng',
  'https://fixng-web-version.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
];

const extraOrigins = process.env.WEB_ORIGIN
  ? process.env.WEB_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

const ALLOWED_ORIGINS = [...new Set([...DEFAULT_ORIGINS, ...extraOrigins])];

module.exports = { ALLOWED_ORIGINS };
