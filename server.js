'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const cfg = require('./lib/config');
const dbmod = require('./lib/db');
const { createSettings } = require('./lib/settings');
const auth = require('./lib/auth');
const orders = require('./lib/orders');
const { parseCookies, rand, readBody, HttpError, safeEq } = require('./lib/util');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.xml': 'application/xml',
};

function createApp() {
  const db = dbmod.open(cfg.DATA_DIR);
  const settings = createSettings(db);
  const app = { db, settings, routes: [], cfg };

  // Create the first administrator from environment variables (only when no admin exists yet).
  if (!db.get("SELECT 1 AS ok FROM users WHERE role = 'admin' LIMIT 1")) {
    if (cfg.ADMIN_EMAIL && cfg.ADMIN_PASSWORD) {
      const bad = auth.validatePassword(cfg.ADMIN_PASSWORD, 12);
      if (bad) throw new Error(`ADMIN_PASSWORD rejected: ${bad}`);
      db.run('INSERT INTO users(email,name,password_hash,role,created_at) VALUES(?,?,?,?,?)', cfg.ADMIN_EMAIL, 'Administrator', auth.hashPassword(cfg.ADMIN_PASSWORD), 'admin', Date.now());
      console.log(`[setup] Administrator account created for ${cfg.ADMIN_EMAIL}. Remove ADMIN_PASSWORD from your environment now.`);
    } else {
      console.warn('[setup] No administrator exists. Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) and restart.');
    }
  }

  app.route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    app.routes.push({ method, re, keys, handler });
  };

  require('./routes/api')(app);
  require('./routes/admin')(app);
  require('./routes/pages')(app);

  setInterval(() => {
    try {
      orders.expireStaleOrders(app);
      db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
      db.run('DELETE FROM reset_tokens WHERE expires_at < ?', Date.now());
    } catch (e) { console.error('[cleanup]', e.message); }
  }, 3600e3).unref();

  app.handler = (req, res) => handle(app, req, res).catch((e) => fail(app, req, res, e));
  return app;
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com",
    "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'",
  ].join('; '));
  if (cfg.SECURE) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function cookieHeader(name, value, { maxAge, httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (httpOnly) c += '; HttpOnly';
  if (cfg.SECURE) c += '; Secure';
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

async function handle(app, req, res) {
  req.ip = cfg.TRUST_PROXY ? ((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress) : req.socket.remoteAddress;
  const url = new URL(req.url, 'http://localhost');
  securityHeaders(res);

  const cookies = parseCookies(req.headers.cookie);
  const session = auth.getSession(app.db, cookies.sid);
  let anonCsrf = cookies.csrf;
  const setCookies = [];
  if (!/^[\w-]{20,64}$/.test(anonCsrf || '')) {
    anonCsrf = rand(24);
    setCookies.push(cookieHeader('csrf', anonCsrf, { maxAge: 31536000 }));
  }

  const c = {
    req, res, url, query: Object.fromEntries(url.searchParams), params: {},
    user: session?.user || null,
    csrf: session ? session.csrf : anonCsrf,
    sid: cookies.sid,
    cookies,
    addCookie: (h) => setCookies.push(h),
    json(data, status = 200) { this.send(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify(data)); },
    html(body, status = 200) { this.send(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }, body); },
    send(status, headers, body) {
      if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
      res.writeHead(status, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    },
    redirect(to, status = 302) { this.send(status, { Location: to, 'Cache-Control': 'no-store' }, ''); },
    async body(max = 1024 * 1024) {
      const buf = await readBody(req, max);
      if (!buf.length) return {};
      try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON.'); }
    },
    requireUser() { if (!this.user) throw new HttpError(401, 'Please sign in.'); return this.user; },
    requireAdmin() { if (!this.user) throw new HttpError(401, 'Please sign in.'); if (this.user.role !== 'admin') throw new HttpError(403, 'Not allowed.'); return this.user; },
    startSession(user) {
      auth.destroySession(app.db, this.sid);
      const s = auth.createSession(app.db, user, req);
      setCookies.push(cookieHeader('sid', s.token, { maxAge: s.maxAgeSec }));
      const row = auth.getSession(app.db, s.token);
      this.user = row.user; this.csrf = row.csrf;
      return row.csrf;
    },
    endSession() {
      auth.destroySession(app.db, this.sid);
      setCookies.push(cookieHeader('sid', '', { maxAge: 0 }));
      this.user = null; this.csrf = anonCsrf;
    },
  };

  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const isApi = url.pathname.startsWith('/api/');

  // CSRF + origin protection for every state-changing request (the Stripe webhook is authenticated by signature instead).
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && url.pathname !== '/webhooks/stripe') {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}` && origin !== cfg.BASE_URL) throw new HttpError(403, 'Cross-site request blocked.');
    if (!safeEq(req.headers['x-csrf-token'] || '', c.csrf)) throw new HttpError(403, 'Security token missing or expired. Refresh the page and try again.');
  }

  for (const r of app.routes) {
    if (r.method !== method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    r.keys.forEach((k, i) => { try { c.params[k] = decodeURIComponent(m[i + 1]); } catch { c.params[k] = m[i + 1]; } });
    return r.handler(c);
  }

  if (method === 'GET' && !isApi) {
    if (serveUpload(c) || serveStatic(c)) return;
  }
  if (isApi) throw new HttpError(404, 'Not found.');
  return app.notFound(c);
}

function serveUpload(c) {
  const m = c.url.pathname.match(/^\/uploads\/([a-f0-9]{32}\.(?:png|jpe?g|webp|gif))$/);
  if (!m) return false;
  return sendFile(c, path.join(cfg.DATA_DIR, 'uploads', m[1]), 86400);
}

function serveStatic(c) {
  let rel;
  try { rel = decodeURIComponent(c.url.pathname); } catch { return false; }
  if (rel.includes('\0') || rel.split('/').some((p) => p.startsWith('.'))) return false;
  const file = path.resolve(cfg.PUBLIC_DIR, '.' + rel);
  if (file !== cfg.PUBLIC_DIR && !file.startsWith(cfg.PUBLIC_DIR + path.sep)) return false;
  return sendFile(c, file, 300);
}

function sendFile(c, file, maxAge) {
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const type = MIME[path.extname(file).toLowerCase()];
  if (!type) return false;
  const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
  if (c.req.headers['if-none-match'] === etag) { c.res.writeHead(304); c.res.end(); return true; }
  c.res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': `public, max-age=${maxAge}`, ETag: etag });
  if (c.req.method === 'HEAD') c.res.end(); else fs.createReadStream(file).pipe(c.res);
  return true;
}

function fail(app, req, res, e) {
  const status = e.status && e.status < 600 ? e.status : 500;
  if (status >= 500 && !(e instanceof HttpError)) console.error(`[error] ${req.method} ${req.url}:`, e);
  if (res.headersSent) { res.destroy(); return; }
  const message = status >= 500 ? 'Something went wrong on our side. Please try again.' : e.message;
  securityHeaders(res);
  const wantsJson = req.url.startsWith('/api/') || req.url.startsWith('/webhooks/') || String(req.headers.accept || '').includes('application/json');
  if (wantsJson) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: message }));
  } else {
    try { app.errorPage({ res, req }, status, message); } catch { res.writeHead(status, { 'Content-Type': 'text/plain' }); res.end(message); }
  }
}

module.exports = { createApp };

if (require.main === module) {
  const app = createApp();
  const server = http.createServer(app.handler);
  server.requestTimeout = 0; // large uploads are bounded by size, not time
  server.headersTimeout = 30000;
  server.listen(cfg.PORT, () => console.log(`Store running at ${cfg.BASE_URL} (port ${cfg.PORT})`));
  const stop = () => { server.close(() => { app.db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
