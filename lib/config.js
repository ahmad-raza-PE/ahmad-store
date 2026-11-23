'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Minimal .env loader (no dependencies). Real environment variables always win.
(function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
})();

const env = process.env;
const BASE_URL = (env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

module.exports = {
  ROOT,
  PORT: parseInt(env.PORT, 10) || 3000,
  BASE_URL,
  SECURE: BASE_URL.startsWith('https://'),
  DATA_DIR: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  TRUST_PROXY: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',

  // First-run administrator (created only if no admin exists yet).
  ADMIN_EMAIL: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',

  // Stripe. STRIPE_API_BASE exists only so the automated tests can point at a local stand-in API.
  STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET || '',
  STRIPE_API_BASE: (env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, ''),

  MAX_UPLOAD_MB: parseInt(env.MAX_UPLOAD_MB, 10) || 500,
  DOWNLOAD_LIMIT: parseInt(env.DOWNLOAD_LIMIT, 10) || 5, // downloads allowed per purchased product
  DOWNLOAD_EXPIRY_DAYS: parseInt(env.DOWNLOAD_EXPIRY_DAYS, 10) || 0, // 0 = never expires

  SMTP: {
    host: env.SMTP_HOST || '',
    port: parseInt(env.SMTP_PORT, 10) || 465,
    secure: env.SMTP_SECURE || 'tls', // 'tls' (465) | 'starttls' (587) | 'none' (tests only)
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || '',
  },
};
