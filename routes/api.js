'use strict';
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const cfg = require('../lib/config');
const auth = require('../lib/auth');
const orders = require('../lib/orders');
const stripe = require('../lib/stripe');
const mailer = require('../lib/mailer');
const { HttpError, isEmail, rateLimit, readBody, rand, sha256 } = require('../lib/util');

const publicProduct = (p) => ({
  id: p.id, slug: p.slug, title: p.title, short_desc: p.short_desc, price_minor: p.price_minor,
  compare_at_minor: p.compare_at_minor, category: p.category, image: p.image,
});

module.exports = function register(app) {
  const { db, settings } = app;
  const ip = (c) => c.req.ip || 'unknown';

  // ---- session / account ---------------------------------------------------------------------
  app.route('GET', '/api/me', (c) => {
    const s = settings.get();
    c.json({ user: c.user, csrf: c.csrf, currency: s.site.currency, tax: { rate: s.tax.rate, label: s.tax.label }, methods: orders.availableMethods(app) });
  });

  app.route('POST', '/api/auth/register', async (c) => {
    if (!rateLimit(`reg:${ip(c)}`, 10, 3600e3)) throw new HttpError(429, 'Too many attempts. Please try again later.');
    const b = await c.body();
    const name = String(b.name || '').trim().slice(0, 100);
    const email = String(b.email || '').trim().toLowerCase();
    if (name.length < 2) throw new HttpError(400, 'Please enter your name.');
    if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
    const bad = auth.validatePassword(b.password);
    if (bad) throw new HttpError(400, bad);
    if (db.get('SELECT 1 AS ok FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with this email already exists. Please sign in.');
    const r = db.run('INSERT INTO users(email,name,phone,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',
      email, name, String(b.phone || '').trim().slice(0, 30) || null, auth.hashPassword(b.password), 'customer', Date.now());
    const user = db.get('SELECT * FROM users WHERE id = ?', r.id);
    const csrf = c.startSession(user);
    c.json({ user: c.user, csrf }, 201);
  });

  app.route('POST', '/api/auth/login', async (c) => {
    const b = await c.body();
    const email = String(b.email || '').trim().toLowerCase();
    if (!rateLimit(`login-ip:${ip(c)}`, 30, 15 * 60e3) || !rateLimit(`login:${email}`, 8, 15 * 60e3)) {
      throw new HttpError(429, 'Too many sign-in attempts. Please wait 15 minutes and try again.');
    }
    const user = db.get('SELECT * FROM users WHERE email = ?', email);
    const ok = user ? auth.verifyPassword(String(b.password || ''), user.password_hash) : auth.burnTime(String(b.password || ''));
    if (!user || !ok || user.disabled) {
      orders.audit(app, user?.id, 'login_failed', { email }, ip(c));
      throw new HttpError(401, 'Incorrect email or password.');
    }
    const csrf = c.startSession(user);
    orders.audit(app, user.id, 'login', '', ip(c));
    c.json({ user: c.user, csrf });
  });

  app.route('POST', '/api/auth/logout', (c) => { c.endSession(); c.json({ ok: true, csrf: c.csrf }); });

  app.route('POST', '/api/auth/forgot', async (c) => {
    if (!rateLimit(`forgot:${ip(c)}`, 5, 3600e3)) throw new HttpError(429, 'Too many requests. Please try again later.');
    const b = await c.body();
    const email = String(b.email || '').trim().toLowerCase();
    const user = isEmail(email) && db.get('SELECT * FROM users WHERE email = ? AND disabled = 0', email);
    if (user && mailer.enabled()) {
      const token = rand(32);
      db.run('INSERT INTO reset_tokens(token_hash,user_id,expires_at) VALUES(?,?,?)', sha256(token), user.id, Date.now() + 3600e3);
      mailer.trySend({
        to: user.email, subject: 'Reset your password',
        text: `Hello ${user.name},\n\nUse this link within one hour to choose a new password:\n${cfg.BASE_URL}/reset?token=${token}\n\nIf you did not ask for this, you can ignore this email.`,
      });
    }
    // Same answer whether or not the account exists.
    c.json({ ok: true, emailEnabled: mailer.enabled() });
  });

  app.route('POST', '/api/auth/reset', async (c) => {
    if (!rateLimit(`reset:${ip(c)}`, 10, 3600e3)) throw new HttpError(429, 'Too many attempts.');
    const b = await c.body();
    const bad = auth.validatePassword(b.password);
    if (bad) throw new HttpError(400, bad);
    const row = db.get('SELECT * FROM reset_tokens WHERE token_hash = ? AND expires_at > ?', sha256(String(b.token || '')), Date.now());
    if (!row) throw new HttpError(400, 'This reset link is invalid or has expired.');
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(b.password), row.user_id);
    db.run('DELETE FROM reset_tokens WHERE user_id = ?', row.user_id);
    auth.destroyUserSessions(db, row.user_id);
    orders.audit(app, row.user_id, 'password_reset', '', ip(c));
    c.json({ ok: true });
  });

  app.route('POST', '/api/me/password', async (c) => {
    const u = c.requireUser();
    const b = await c.body();
    const row = db.get('SELECT * FROM users WHERE id = ?', u.id);
    if (!auth.verifyPassword(String(b.current || ''), row.password_hash)) throw new HttpError(400, 'Your current password is incorrect.');
    const bad = auth.validatePassword(b.password, u.role === 'admin' ? 12 : 8);
    if (bad) throw new HttpError(400, bad);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(b.password), u.id);
    auth.destroyUserSessions(db, u.id);
    const csrf = c.startSession(row);
    orders.audit(app, u.id, 'password_changed', '', ip(c));
    c.json({ ok: true, csrf });
  });

  // ---- catalogue -------------------------------------------------------------------------------
  app.route('GET', '/api/products', (c) => {
    const ids = String(c.query.ids || '').split(',').map(Number).filter(Number.isInteger).slice(0, 50);
    if (!ids.length) return c.json({ products: [] });
    const rows = ids.map((id) => db.get("SELECT * FROM products WHERE id = ? AND status = 'published'", id)).filter(Boolean);
    c.json({ products: rows.map(publicProduct) });
  });

  // ---- checkout & orders -----------------------------------------------------------------------
  app.route('POST', '/api/checkout', async (c) => {
    const user = c.requireUser();
    if (!rateLimit(`checkout:${user.id}`, 20, 3600e3)) throw new HttpError(429, 'Too many orders. Please try again later.');
    const b = await c.body();
    const order = orders.createOrder(app, user, b.items, b.method);
    if (order.method === 'card') {
      try {
        const url = await orders.startCardPayment(app, order);
        return c.json({ order: order.number, url });
      } catch (e) {
        console.error('[checkout] Stripe session failed:', e.message);
        db.run("UPDATE orders SET status = 'cancelled' WHERE id = ?", order.id);
        throw new HttpError(502, 'We could not start the card payment. Please try again, or choose bank transfer.');
      }
    }
    c.json({ order: order.number });
  });

  const ownedOrder = (c, number) => {
    const u = c.requireUser();
    const o = db.get('SELECT * FROM orders WHERE number = ?', number);
    if (!o || (o.user_id !== u.id && u.role !== 'admin')) throw new HttpError(404, 'Order not found.');
    return o;
  };

  app.route('GET', '/api/orders', (c) => {
    const u = c.requireUser();
    c.json({ orders: orders.listOrders(app, u.id) });
  });

  const orderPayload = (o) => {
    const s = settings.get();
    const d = orders.orderDetail(app, o);
    if (o.method === 'bank_transfer' && o.status === 'awaiting_transfer') d.bank = s.bank;
    return d;
  };

  app.route('GET', '/api/orders/:number', (c) => c.json({ order: orderPayload(ownedOrder(c, c.params.number)) }));

  // Server-to-server confirmation with Stripe: the browser only asks "what is the status?"; it can never declare payment.
  app.route('POST', '/api/orders/:number/refresh', async (c) => {
    let o = ownedOrder(c, c.params.number);
    o = await orders.refreshCardOrder(app, o);
    c.json({ order: orderPayload(o) });
  });

  app.route('POST', '/api/orders/:number/pay', async (c) => {
    const o = ownedOrder(c, c.params.number);
    if (o.method !== 'card' || o.status !== 'pending') throw new HttpError(400, 'This order cannot be paid online.');
    try { c.json({ url: await orders.startCardPayment(app, o) }); } catch (e) {
      console.error('[checkout] retry failed:', e.message);
      throw new HttpError(502, 'We could not start the card payment. Please try again.');
    }
  });

  // ---- contact form ------------------------------------------------------------------------------
  app.route('POST', '/api/contact', async (c) => {
    if (!rateLimit(`contact:${ip(c)}`, 5, 3600e3)) throw new HttpError(429, 'Too many messages. Please try again later.');
    const b = await c.body();
    if (b.website) return c.json({ ok: true }); // honeypot field: bots fill it, people never see it
    const name = String(b.name || '').trim().slice(0, 100);
    const email = String(b.email || '').trim();
    const message = String(b.message || '').trim().slice(0, 5000);
    if (name.length < 2 || !isEmail(email) || message.length < 10) throw new HttpError(400, 'Please fill in your name, a valid email and a message of at least 10 characters.');
    db.run('INSERT INTO messages(name,email,subject,body,created_at) VALUES(?,?,?,?,?)', name, email, String(b.subject || '').trim().slice(0, 150), message, Date.now());
    c.json({ ok: true });
  });

  // ---- Stripe webhook: the ONLY automatic path that can mark a card order paid ------------------------
  app.route('POST', '/webhooks/stripe', async (c) => {
    if (!stripe.configured()) throw new HttpError(503, 'Webhook not configured.');
    const raw = await readBody(c.req, 1024 * 1024);
    let event;
    try { event = stripe.verifyWebhook(raw, c.req.headers['stripe-signature']); } catch (e) {
      orders.audit(app, null, 'webhook_rejected', e.message, ip(c));
      throw new HttpError(400, 'Invalid webhook signature.');
    }
    if (db.get('SELECT 1 AS ok FROM processed_events WHERE id = ?', event.id)) return c.json({ received: true, duplicate: true });
    const outcome = orders.handleStripeEvent(app, event);
    db.run('INSERT OR IGNORE INTO processed_events(id,created_at) VALUES(?,?)', event.id, Date.now());
    c.json({ received: true, outcome });
  });

  // ---- protected downloads ---------------------------------------------------------------------------
  // Files live in DATA_DIR/private (never inside the public folder). Access requires: signed-in owner + paid order +
  // un-revoked, unexpired grant + remaining allowance for that file.
  app.route('GET', '/download/:grant/:file', async (c) => {
    if (!c.user) return c.redirect(`/account?next=${encodeURIComponent(c.url.pathname)}`);
    const g = db.get(
      `SELECT g.*, o.status AS order_status FROM download_grants g
         JOIN order_items oi ON oi.id = g.order_item_id JOIN orders o ON o.id = oi.order_id WHERE g.id = ?`, Number(c.params.grant) || 0,
    );
    if (!g || g.user_id !== c.user.id) throw new HttpError(404, 'File not found.');
    if (g.order_status !== 'paid') throw new HttpError(403, 'Payment for this order has not been verified.');
    const st = orders.grantState(g);
    if (!st.downloadable) throw new HttpError(403, st.reason === 'expired' ? 'This download has expired. Please contact us.' : 'Download access for this item has been disabled. Please contact us.');
    const f = db.get('SELECT * FROM product_files WHERE id = ? AND product_id = ?', Number(c.params.file) || 0, g.product_id);
    if (!f || !/^[a-f0-9]{32}$/.test(f.stored_name)) throw new HttpError(404, 'File not found.');
    const used = db.get('SELECT COUNT(*) AS n FROM download_log WHERE grant_id = ? AND file_id = ? AND created_at > ?', g.id, f.id, g.reset_at).n;
    if (used >= g.max_downloads) throw new HttpError(403, 'Download limit reached for this file. Contact us and we will reset it.');
    const full = path.join(cfg.DATA_DIR, 'private', f.stored_name);
    let stat;
    try { stat = fs.statSync(full); } catch { throw new HttpError(404, 'File is temporarily unavailable. Please contact us.'); }
    if (c.req.method !== 'HEAD') db.run('INSERT INTO download_log(grant_id,file_id,user_id,ip,created_at) VALUES(?,?,?,?,?)', g.id, f.id, c.user.id, ip(c), Date.now());
    const safeName = f.original_name.replace(/[^\w.\- ()]+/g, '_');
    c.res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (c.req.method === 'HEAD') return c.res.end();
    await pipeline(fs.createReadStream(full), c.res).catch(() => {});
  });
};
