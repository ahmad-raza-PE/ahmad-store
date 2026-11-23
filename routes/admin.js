'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const cfg = require('../lib/config');
const auth = require('../lib/auth');
const orders = require('../lib/orders');
const stripe = require('../lib/stripe');
const mailer = require('../lib/mailer');
const { DEFAULTS } = require('../lib/settings');
const { HttpError, slugify, toMinor, readBody } = require('../lib/util');

const FILE_EXT = new Set(['html', 'htm', 'zip', 'rar', '7z', 'pdf', 'xlsx', 'xlsm', 'xls', 'xltx', 'csv', 'docx', 'doc', 'dotx', 'pptx', 'ppt', 'potx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'xer', 'xml', 'mpp', 'mp4', 'mov', 'mp3', 'json', 'epub']);
const TZ_HOURS = parseInt(process.env.TZ_OFFSET_HOURS, 10) || 4; // reports are grouped by UAE local date

function sniffImage(buf) {
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 6 && buf.slice(0, 3).toString() === 'GIF') return 'gif';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // prevents spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

module.exports = function register(app) {
  const { db, settings } = app;
  const A = (handler) => async (c) => { c.requireAdmin(); return handler(c); };
  const ip = (c) => c.req.ip || 'unknown';
  const log = (c, action, detail) => orders.audit(app, c.user.id, action, detail, ip(c));

  // ---- dashboard & reports ------------------------------------------------------------------------
  app.route('GET', '/api/admin/stats', A((c) => {
    const s = settings.get();
    const off = `+${TZ_HOURS} hours`;
    const sum = db.get("SELECT COALESCE(SUM(total_minor),0) AS revenue, COALESCE(SUM(tax_minor),0) AS tax, COUNT(*) AS n FROM orders WHERE status = 'paid'");
    const counts = Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').map((r) => [r.status, r.n]));
    const since30 = Date.now() - 30 * 86400e3;
    const daily = db.all(
      `SELECT date(paid_at/1000,'unixepoch',?) AS day, COUNT(*) AS orders, SUM(total_minor) AS revenue
         FROM orders WHERE status = 'paid' AND paid_at >= ? GROUP BY day ORDER BY day`, off, since30);
    const monthly = db.all(
      `SELECT strftime('%Y-%m', paid_at/1000,'unixepoch',?) AS month, COUNT(*) AS orders, SUM(total_minor) AS revenue
         FROM orders WHERE status = 'paid' GROUP BY month ORDER BY month DESC LIMIT 12`, off).reverse();
    const top = db.all(
      `SELECT oi.title, COUNT(*) AS units, SUM(oi.unit_minor) AS revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'paid' GROUP BY oi.product_id ORDER BY revenue DESC LIMIT 8`);
    const last30 = db.get("SELECT COALESCE(SUM(total_minor),0) AS revenue, COUNT(*) AS n FROM orders WHERE status = 'paid' AND paid_at >= ?", since30);
    c.json({
      currency: s.site.currency,
      revenue_minor: sum.revenue, tax_minor: sum.tax, paid_orders: sum.n,
      last30_minor: last30.revenue, last30_orders: last30.n,
      counts,
      customers: db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").n,
      products: db.get("SELECT COUNT(*) AS n FROM products WHERE status = 'published'").n,
      unread_messages: db.get('SELECT COUNT(*) AS n FROM messages WHERE handled = 0').n,
      daily, monthly, top,
      recent: db.all('SELECT number, status, method, total_minor, currency, billing_name, created_at FROM orders ORDER BY id DESC LIMIT 8'),
    });
  }));

  // ---- products ------------------------------------------------------------------------------------
  const productRow = (p) => ({
    ...p,
    files: db.all('SELECT id, original_name, size, created_at FROM product_files WHERE product_id = ? ORDER BY id', p.id),
    sales: db.get("SELECT COUNT(*) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = ? AND o.status = 'paid'", p.id).n,
  });

  function parseProduct(b, id = null) {
    const title = String(b.title || '').trim();
    if (title.length < 3 || title.length > 150) throw new HttpError(400, 'Title must be 3 to 150 characters.');
    const price = toMinor(b.price);
    if (price === null || price < 200) throw new HttpError(400, 'Enter a valid price of at least 2.00. Every product needs a price.');
    let compare = null;
    if (String(b.compare_at ?? '').trim() !== '') {
      compare = toMinor(b.compare_at);
      if (compare === null || compare <= price) throw new HttpError(400, 'The original (crossed-out) price must be higher than the price.');
    }
    const image = String(b.image || '').trim();
    if (image && !/^\/uploads\/[a-f0-9]{32}\.(png|jpe?g|webp|gif)$/.test(image) && !/^https:\/\/[^\s"'<>]+$/.test(image)) throw new HttpError(400, 'Invalid image.');
    const status = ['draft', 'published', 'archived'].includes(b.status) ? b.status : 'draft';
    let slug = slugify(b.slug || title);
    const base = slug;
    for (let i = 2; db.get('SELECT 1 AS ok FROM products WHERE slug = ? AND id IS NOT ?', slug, id); i++) slug = `${base}-${i}`;
    return {
      slug, title, price_minor: price, compare_at_minor: compare, image, status,
      short_desc: String(b.short_desc || '').trim().slice(0, 300),
      description: String(b.description || '').slice(0, 20000),
      category: String(b.category || 'General').trim().slice(0, 60) || 'General',
      tags: String(b.tags || '').trim().slice(0, 200),
      featured: b.featured === true || b.featured === 'true' ? 1 : 0,
      seo_title: String(b.seo_title || '').trim().slice(0, 70),
      seo_desc: String(b.seo_desc || '').trim().slice(0, 200),
    };
  }

  const requirePublishable = (id, p) => {
    if (p.status === 'published' && !db.get('SELECT 1 AS ok FROM product_files WHERE product_id = ? LIMIT 1', id)) {
      throw new HttpError(400, 'Upload at least one file before publishing, otherwise customers would pay for nothing.');
    }
  };

  app.route('GET', '/api/admin/products', A((c) => {
    c.json({ products: db.all('SELECT * FROM products ORDER BY id DESC').map(productRow) });
  }));

  app.route('POST', '/api/admin/products', A(async (c) => {
    const p = parseProduct(await c.body());
    if (p.status === 'published') throw new HttpError(400, 'Save as a draft first, upload the file(s), then publish.');
    const t = Date.now();
    const r = db.run(
      `INSERT INTO products(slug,title,short_desc,description,price_minor,compare_at_minor,category,tags,image,status,featured,seo_title,seo_desc,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      p.slug, p.title, p.short_desc, p.description, p.price_minor, p.compare_at_minor, p.category, p.tags, p.image, p.status, p.featured, p.seo_title, p.seo_desc, t, t);
    log(c, 'product_created', p.title);
    c.json({ product: productRow(db.get('SELECT * FROM products WHERE id = ?', r.id)) }, 201);
  }));

  app.route('PUT', '/api/admin/products/:id', A(async (c) => {
    const id = Number(c.params.id);
    if (!db.get('SELECT 1 AS ok FROM products WHERE id = ?', id)) throw new HttpError(404, 'Product not found.');
    const p = parseProduct(await c.body(), id);
    requirePublishable(id, p);
    db.run(
      `UPDATE products SET slug=?,title=?,short_desc=?,description=?,price_minor=?,compare_at_minor=?,category=?,tags=?,image=?,status=?,featured=?,seo_title=?,seo_desc=?,updated_at=? WHERE id=?`,
      p.slug, p.title, p.short_desc, p.description, p.price_minor, p.compare_at_minor, p.category, p.tags, p.image, p.status, p.featured, p.seo_title, p.seo_desc, Date.now(), id);
    log(c, 'product_updated', `${p.title} price=${p.price_minor}`);
    c.json({ product: productRow(db.get('SELECT * FROM products WHERE id = ?', id)) });
  }));

  app.route('DELETE', '/api/admin/products/:id', A((c) => {
    const id = Number(c.params.id);
    const p = db.get('SELECT * FROM products WHERE id = ?', id);
    if (!p) throw new HttpError(404, 'Product not found.');
    if (db.get('SELECT 1 AS ok FROM order_items WHERE product_id = ? LIMIT 1', id)) {
      // Sold products are archived, not deleted: customers keep their purchased files and order history.
      db.run("UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?", Date.now(), id);
      log(c, 'product_archived', p.title);
      return c.json({ archived: true });
    }
    for (const f of db.all('SELECT stored_name FROM product_files WHERE product_id = ?', id)) fs.rmSync(path.join(cfg.DATA_DIR, 'private', f.stored_name), { force: true });
    db.run('DELETE FROM products WHERE id = ?', id);
    log(c, 'product_deleted', p.title);
    c.json({ deleted: true });
  }));

  // Raw-body upload of a deliverable file into private storage.
  app.route('POST', '/api/admin/products/:id/files', A(async (c) => {
    const id = Number(c.params.id);
    if (!db.get('SELECT 1 AS ok FROM products WHERE id = ?', id)) throw new HttpError(404, 'Product not found.');
    const original = path.basename(String(c.query.name || '')).replace(/[\u0000-\u001f]/g, '').slice(0, 200);
    const ext = path.extname(original).slice(1).toLowerCase();
    if (!original || !FILE_EXT.has(ext)) throw new HttpError(400, `File type ".${ext}" is not allowed. Allowed: ${[...FILE_EXT].join(', ')}.`);
    const max = cfg.MAX_UPLOAD_MB * 1024 * 1024;
    const stored = crypto.randomBytes(16).toString('hex');
    const dir = path.join(cfg.DATA_DIR, 'private');
    const tmp = path.join(dir, `.tmp-${stored}`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk, _e, cb) {
        size += chunk.length;
        if (size > max) return cb(new HttpError(413, `File is larger than the ${cfg.MAX_UPLOAD_MB} MB limit.`));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(c.req, meter, fs.createWriteStream(tmp));
      if (!size) throw new HttpError(400, 'The file is empty.');
      fs.renameSync(tmp, path.join(dir, stored));
    } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    const r = db.run('INSERT INTO product_files(product_id,stored_name,original_name,size,sha256,created_at) VALUES(?,?,?,?,?,?)', id, stored, original, size, hash.digest('hex'), Date.now());
    log(c, 'file_uploaded', `${original} (${size} bytes) -> product ${id}`);
    c.json({ file: db.get('SELECT id, original_name, size, created_at FROM product_files WHERE id = ?', r.id) }, 201);
  }));

  app.route('DELETE', '/api/admin/files/:id', A((c) => {
    const f = db.get('SELECT * FROM product_files WHERE id = ?', Number(c.params.id));
    if (!f) throw new HttpError(404, 'File not found.');
    const p = db.get('SELECT * FROM products WHERE id = ?', f.product_id);
    if (p.status === 'published' && db.get('SELECT COUNT(*) AS n FROM product_files WHERE product_id = ?', p.id).n <= 1) {
      throw new HttpError(400, 'A published product needs at least one file. Unpublish it first or upload the replacement before deleting this one.');
    }
    fs.rmSync(path.join(cfg.DATA_DIR, 'private', f.stored_name), { force: true });
    db.run('DELETE FROM product_files WHERE id = ?', f.id);
    log(c, 'file_deleted', f.original_name);
    c.json({ deleted: true });
  }));

  // Admin can fetch a file to check what customers receive (separate from customer download counting).
  app.route('GET', '/api/admin/files/:id/download', A(async (c) => {
    const f = db.get('SELECT * FROM product_files WHERE id = ?', Number(c.params.id));
    if (!f || !/^[a-f0-9]{32}$/.test(f.stored_name)) throw new HttpError(404, 'File not found.');
    const full = path.join(cfg.DATA_DIR, 'private', f.stored_name);
    const st = fs.statSync(full);
    c.res.writeHead(200, {
      'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${f.original_name.replace(/[^\w.\- ()]+/g, '_')}"`,
    });
    await pipeline(fs.createReadStream(full), c.res).catch(() => {});
  }));

  app.route('POST', '/api/admin/images', A(async (c) => {
    const buf = await readBody(c.req, 5 * 1024 * 1024);
    const ext = sniffImage(buf);
    if (!ext) throw new HttpError(400, 'Please upload a PNG, JPG, GIF or WebP image (max 5 MB).');
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(cfg.DATA_DIR, 'uploads', name), buf);
    c.json({ path: `/uploads/${name}` }, 201);
  }));

  // ---- orders & payments --------------------------------------------------------------------------
  app.route('GET', '/api/admin/orders', A((c) => {
    const where = [];
    const args = [];
    if (c.query.status) { where.push('o.status = ?'); args.push(String(c.query.status)); }
    if (c.query.q) { where.push('(o.number LIKE ? OR o.billing_email LIKE ? OR o.billing_name LIKE ?)'); const q = `%${String(c.query.q).slice(0, 60)}%`; args.push(q, q, q); }
    const rows = db.all(
      `SELECT o.*, (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count FROM orders o
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.id DESC LIMIT 300`, ...args);
    c.json({ orders: rows });
  }));

  app.route('GET', '/api/admin/orders.csv', A((c) => {
    const rows = db.all('SELECT o.*, u.email AS account_email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC');
    const head = ['Order', 'Date', 'Status', 'Method', 'Customer', 'Email', 'Currency', 'Subtotal', 'Tax', 'Total', 'Paid at'];
    const lines = [head.map(csvCell).join(',')];
    for (const o of rows) {
      lines.push([o.number, new Date(o.created_at).toISOString(), o.status, o.method, o.billing_name, o.billing_email, o.currency,
        (o.subtotal_minor / 100).toFixed(2), (o.tax_minor / 100).toFixed(2), (o.total_minor / 100).toFixed(2), o.paid_at ? new Date(o.paid_at).toISOString() : ''].map(csvCell).join(','));
    }
    c.send(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="orders.csv"', 'Cache-Control': 'no-store' }, lines.join('\r\n'));
  }));

  const orderById = (id) => {
    const o = db.get('SELECT * FROM orders WHERE id = ?', Number(id));
    if (!o) throw new HttpError(404, 'Order not found.');
    return o;
  };

  app.route('GET', '/api/admin/orders/:id', A((c) => {
    const o = orderById(c.params.id);
    const d = orders.orderDetail(app, o, { admin: true });
    d.customer = db.get('SELECT id, name, email, phone FROM users WHERE id = ?', o.user_id);
    d.downloads = db.all('SELECT l.created_at, l.ip, f.original_name FROM download_log l LEFT JOIN product_files f ON f.id = l.file_id WHERE l.grant_id IN (SELECT g.id FROM download_grants g JOIN order_items oi ON oi.id = g.order_item_id WHERE oi.order_id = ?) ORDER BY l.id DESC LIMIT 50', o.id);
    c.json({ order: d });
  }));

  app.route('POST', '/api/admin/orders/:id/mark-paid', A(async (c) => {
    const o = orderById(c.params.id);
    const b = await c.body();
    const note = String(b.note || '').trim().slice(0, 300);
    if (note.length < 3) throw new HttpError(400, 'Enter the bank reference or a short note describing how you verified this payment.');
    if (o.status === 'paid') throw new HttpError(400, 'This order is already paid.');
    if (o.status === 'refunded') throw new HttpError(400, 'Refunded orders cannot be marked as paid.');
    const r = orders.markPaid(app, o.id, { provider: o.method === 'bank_transfer' ? 'bank_transfer' : 'manual', detail: `Confirmed by admin: ${note}`, actorId: c.user.id, ip: ip(c) });
    if (!r.ok) throw new HttpError(400, 'Could not mark the order as paid.');
    c.json({ order: orders.orderDetail(app, orderById(o.id), { admin: true }) });
  }));

  app.route('POST', '/api/admin/orders/:id/refund', A((c) => {
    const o = orderById(c.params.id);
    if (o.status !== 'paid') throw new HttpError(400, 'Only paid orders can be refunded.');
    orders.refundOrder(app, o.id, { detail: 'Marked refunded by admin (issue the money refund in Stripe or your bank)', actorId: c.user.id, ip: ip(c) });
    c.json({ order: orders.orderDetail(app, orderById(o.id), { admin: true }) });
  }));

  app.route('POST', '/api/admin/orders/:id/cancel', A((c) => {
    orders.cancelOrder(app, Number(c.params.id), c.user.id, ip(c));
    c.json({ order: orders.orderDetail(app, orderById(c.params.id), { admin: true }) });
  }));

  // ---- download permissions ---------------------------------------------------------------------------
  app.route('POST', '/api/admin/grants/:id', A(async (c) => {
    const g = db.get('SELECT * FROM download_grants WHERE id = ?', Number(c.params.id));
    if (!g) throw new HttpError(404, 'Download permission not found.');
    const b = await c.body();
    switch (b.action) {
      case 'revoke': db.run('UPDATE download_grants SET revoked = 1 WHERE id = ?', g.id); break;
      case 'restore': db.run('UPDATE download_grants SET revoked = 0 WHERE id = ?', g.id); break;
      case 'reset': db.run('UPDATE download_grants SET reset_at = ? WHERE id = ?', Date.now(), g.id); break;
      case 'extend': {
        const n = Math.min(100, Math.max(1, parseInt(b.amount, 10) || 5));
        db.run('UPDATE download_grants SET max_downloads = max_downloads + ? WHERE id = ?', n, g.id);
        break;
      }
      default: throw new HttpError(400, 'Unknown action.');
    }
    log(c, `grant_${b.action}`, `grant ${g.id}`);
    const oi = db.get('SELECT order_id FROM order_items WHERE id = ?', g.order_item_id);
    c.json({ order: orders.orderDetail(app, orderById(oi.order_id), { admin: true }) });
  }));

  // ---- customers & messages ---------------------------------------------------------------------------------
  app.route('GET', '/api/admin/customers', A((c) => {
    c.json({
      customers: db.all(
        `SELECT u.id, u.name, u.email, u.phone, u.disabled, u.created_at,
                (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS paid_orders,
                (SELECT COALESCE(SUM(total_minor),0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS spent_minor
           FROM users u WHERE u.role = 'customer' ORDER BY u.id DESC LIMIT 500`),
    });
  }));

  app.route('POST', '/api/admin/customers/:id/disable', A(async (c) => {
    const u = db.get("SELECT * FROM users WHERE id = ? AND role = 'customer'", Number(c.params.id));
    if (!u) throw new HttpError(404, 'Customer not found.');
    const b = await c.body();
    db.run('UPDATE users SET disabled = ? WHERE id = ?', b.disabled ? 1 : 0, u.id);
    if (b.disabled) auth.destroyUserSessions(db, u.id);
    log(c, b.disabled ? 'customer_disabled' : 'customer_enabled', u.email);
    c.json({ ok: true });
  }));

  app.route('POST', '/api/admin/customers/:id/password', A(async (c) => {
    const u = db.get("SELECT * FROM users WHERE id = ? AND role = 'customer'", Number(c.params.id));
    if (!u) throw new HttpError(404, 'Customer not found.');
    const b = await c.body();
    const bad = auth.validatePassword(b.password);
    if (bad) throw new HttpError(400, bad);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(b.password), u.id);
    auth.destroyUserSessions(db, u.id);
    log(c, 'customer_password_set', u.email);
    c.json({ ok: true });
  }));

  app.route('GET', '/api/admin/messages', A((c) => c.json({ messages: db.all('SELECT * FROM messages ORDER BY id DESC LIMIT 200') })));
  app.route('POST', '/api/admin/messages/:id', A(async (c) => {
    const b = await c.body();
    db.run('UPDATE messages SET handled = ? WHERE id = ?', b.handled ? 1 : 0, Number(c.params.id));
    c.json({ ok: true });
  }));

  // ---- site content (no code edits needed) ----------------------------------------------------------------------
  app.route('GET', '/api/admin/settings', A((c) => {
    c.json({
      settings: settings.get(),
      server: {
        base_url: cfg.BASE_URL,
        webhook_url: `${cfg.BASE_URL}/webhooks/stripe`,
        stripe_configured: stripe.configured(),
        stripe_mode: cfg.STRIPE_SECRET_KEY.startsWith('sk_live') || cfg.STRIPE_SECRET_KEY.startsWith('rk_live') ? 'live' : cfg.STRIPE_SECRET_KEY ? 'test' : 'off',
        smtp_enabled: mailer.enabled(),
        download_limit: cfg.DOWNLOAD_LIMIT,
        max_upload_mb: cfg.MAX_UPLOAD_MB,
        https: cfg.SECURE,
      },
    });
  }));

  app.route('PUT', '/api/admin/settings/:section', A(async (c) => {
    if (!(c.params.section in DEFAULTS)) throw new HttpError(404, 'Unknown section.');
    const b = await c.body(2 * 1024 * 1024);
    if (c.params.section === 'tax' && (Number(b.rate) < 0 || Number(b.rate) > 30)) throw new HttpError(400, 'Tax rate must be between 0 and 30.');
    if (c.params.section === 'site' && !/^[A-Za-z]{3}$/.test(String(b.currency || ''))) throw new HttpError(400, 'Currency must be a 3-letter code such as AED or USD.');
    if (c.params.section === 'site') b.currency = String(b.currency).toUpperCase();
    if (c.params.section === 'analytics' && b.ga_id && !/^(G|UA|GT)-[A-Z0-9-]{4,20}$/i.test(b.ga_id)) throw new HttpError(400, 'Enter a Google Analytics ID like G-XXXXXXXXXX.');
    const saved = settings.set(c.params.section, b);
    log(c, 'settings_updated', c.params.section);
    c.json({ section: c.params.section, value: saved });
  }));

  app.route('GET', '/api/admin/audit', A((c) => c.json({ audit: db.all('SELECT a.*, u.email FROM audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200') })));
};
