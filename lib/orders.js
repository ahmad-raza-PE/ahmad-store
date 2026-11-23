'use strict';
/* Order, payment-verification and download-permission logic.
   Rule: an order only becomes "paid" (and downloads only exist) through markPaid(), which is called from
   (a) a signature-verified Stripe webhook, (b) a server-to-server Stripe lookup, or (c) an admin confirming a bank transfer. */
const cfg = require('./config');
const stripe = require('./stripe');
const mailer = require('./mailer');
const { HttpError, money } = require('./util');

const now = () => Date.now();

function audit(app, userId, action, detail, ip) {
  app.db.run('INSERT INTO audit(user_id,action,detail,ip,created_at) VALUES(?,?,?,?,?)',
    userId || null, action, typeof detail === 'string' ? detail : JSON.stringify(detail), ip || null, now());
}

function availableMethods(app) {
  const s = app.settings.get();
  return {
    card: stripe.configured() && s.payments.card_enabled,
    bank_transfer: Boolean(s.bank.enabled && s.bank.holder && s.bank.iban),
  };
}

function createOrder(app, user, productIds, method) {
  const s = app.settings.get();
  const methods = availableMethods(app);
  if (!['card', 'bank_transfer'].includes(method) || !methods[method]) throw new HttpError(400, 'That payment method is not available.');
  const ids = [...new Set((Array.isArray(productIds) ? productIds : []).map(Number).filter(Number.isInteger))].slice(0, 50);
  if (!ids.length) throw new HttpError(400, 'Your cart is empty.');

  const products = ids.map((id) => app.db.get("SELECT * FROM products WHERE id = ? AND status = 'published'", id));
  if (products.some((p) => !p)) throw new HttpError(400, 'One or more products are no longer available. Please review your cart.');
  for (const p of products) {
    if (!app.db.get('SELECT 1 AS ok FROM product_files WHERE product_id = ? LIMIT 1', p.id)) throw new HttpError(400, `"${p.title}" is not available right now.`);
  }
  const owned = new Set(app.db.all(
    `SELECT oi.product_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = ? AND o.status = 'paid'`, user.id,
  ).map((r) => r.product_id));
  const dup = products.find((p) => owned.has(p.id));
  if (dup) throw new HttpError(409, `You already own "${dup.title}". You can download it from your account.`);

  const subtotal = products.reduce((n, p) => n + p.price_minor, 0); // prices always come from the database
  const rate = Number(s.tax.rate) || 0;
  const tax = Math.round((subtotal * rate) / 100);
  const total = subtotal + tax;
  const status = method === 'card' ? 'pending' : 'awaiting_transfer';

  return app.db.tx(() => {
    const o = app.db.run(
      `INSERT INTO orders(user_id,status,method,currency,subtotal_minor,tax_minor,tax_rate,total_minor,billing_name,billing_email,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      user.id, status, method, s.site.currency, subtotal, tax, rate, total, user.name, user.email, now(),
    );
    const number = `AR-${new Date().getFullYear()}-${String(o.id).padStart(6, '0')}`;
    app.db.run('UPDATE orders SET number = ? WHERE id = ?', number, o.id);
    for (const p of products) app.db.run('INSERT INTO order_items(order_id,product_id,title,unit_minor) VALUES(?,?,?,?)', o.id, p.id, p.title, p.price_minor);
    if (method === 'bank_transfer') {
      app.db.run('INSERT INTO payments(order_id,provider,amount_minor,currency,status,created_at) VALUES(?,?,?,?,?,?)', o.id, 'bank_transfer', total, s.site.currency, 'created', now());
    }
    return app.db.get('SELECT * FROM orders WHERE id = ?', o.id);
  });
}

async function startCardPayment(app, order) {
  if (!stripe.configured()) throw new HttpError(400, 'Card payments are not available.');
  const s = app.settings.get();
  const items = app.db.all('SELECT title, unit_minor FROM order_items WHERE order_id = ?', order.id);
  const session = await stripe.createCheckoutSession({
    order, items, taxLabel: s.tax.label, email: order.billing_email,
    successUrl: `${cfg.BASE_URL}/order/${order.number}?return=1`,
    cancelUrl: `${cfg.BASE_URL}/order/${order.number}?cancelled=1`,
  });
  app.db.run('INSERT INTO payments(order_id,provider,provider_ref,amount_minor,currency,status,created_at) VALUES(?,?,?,?,?,?,?)',
    order.id, 'stripe', session.id, order.total_minor, order.currency, 'created', now());
  return session.url;
}

// The single place where an order becomes paid and download permissions are created.
function markPaid(app, orderId, { provider, providerRef = null, intentRef = null, detail = '', actorId = null, ip = null }) {
  const result = app.db.tx(() => {
    const o = app.db.get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) return { ok: false, reason: 'unknown_order' };
    if (o.status === 'paid') return { ok: true, already: true, order: o };
    if (o.status === 'refunded') return { ok: false, reason: 'order_refunded' };

    app.db.run("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?", now(), o.id);
    const existing = providerRef && app.db.get('SELECT id FROM payments WHERE order_id = ? AND provider_ref = ?', o.id, providerRef);
    if (existing) {
      app.db.run("UPDATE payments SET status = 'succeeded', intent_ref = ?, detail = ? WHERE id = ?", intentRef, detail, existing.id);
    } else {
      const open = provider === 'bank_transfer' && app.db.get("SELECT id FROM payments WHERE order_id = ? AND provider = 'bank_transfer' AND status = 'created'", o.id);
      if (open) app.db.run("UPDATE payments SET status = 'succeeded', detail = ? WHERE id = ?", detail, open.id);
      else app.db.run('INSERT INTO payments(order_id,provider,provider_ref,intent_ref,amount_minor,currency,status,detail,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        o.id, provider, providerRef, intentRef, o.total_minor, o.currency, 'succeeded', detail, now());
    }
    const expires = cfg.DOWNLOAD_EXPIRY_DAYS > 0 ? now() + cfg.DOWNLOAD_EXPIRY_DAYS * 86400e3 : null;
    for (const it of app.db.all('SELECT * FROM order_items WHERE order_id = ?', o.id)) {
      app.db.run(
        `INSERT INTO download_grants(order_item_id,user_id,product_id,max_downloads,expires_at,created_at)
         VALUES(?,?,?,?,?,?) ON CONFLICT(order_item_id) DO NOTHING`,
        it.id, o.user_id, it.product_id, cfg.DOWNLOAD_LIMIT, expires, now(),
      );
    }
    audit(app, actorId, 'order_paid', { order: o.number, provider, ref: providerRef }, ip);
    return { ok: true, order: { ...o, status: 'paid' } };
  });
  if (result.ok && !result.already) sendConfirmation(app, result.order);
  return result;
}

function sendConfirmation(app, order) {
  if (!mailer.enabled()) return;
  const s = app.settings.get();
  const items = app.db.all('SELECT title, unit_minor FROM order_items WHERE order_id = ?', order.id);
  const text = [
    `Hello ${order.billing_name},`, '',
    `Thank you for your purchase. Your payment for order ${order.number} has been verified and your downloads are unlocked.`, '',
    ...items.map((i) => `- ${i.title}: ${money(i.unit_minor, order.currency)}`),
    order.tax_minor ? `- ${s.tax.label} (${order.tax_rate}%): ${money(order.tax_minor, order.currency)}` : null,
    `Total paid: ${money(order.total_minor, order.currency)}`, '',
    `Download your files and view your receipt: ${cfg.BASE_URL}/order/${order.number}`, '',
    `${s.site.name}`,
  ].filter((l) => l !== null).join('\n');
  mailer.trySend({ to: order.billing_email, subject: `Order ${order.number} confirmed`, text });
}

// ---- Stripe: webhook + server-side confirmation ------------------------------------------------
function fulfillFromSession(app, session) {
  const order = app.db.get('SELECT * FROM orders WHERE id = ?', Number(session.client_reference_id) || 0);
  if (!order) return 'ignored: unknown order';
  const pay = app.db.get("SELECT * FROM payments WHERE order_id = ? AND provider = 'stripe' AND provider_ref = ?", order.id, session.id);
  if (!pay) { audit(app, null, 'payment_rejected', { reason: 'session not created by this store', order: order.number, session: session.id }); return 'ignored: unknown session'; }
  if (session.payment_status !== 'paid') return 'ignored: not paid yet';

  // Verify amount and currency against OUR database record, never against anything the browser sent.
  if (Number(session.amount_total) !== order.total_minor || String(session.currency).toLowerCase() !== order.currency.toLowerCase()) {
    app.db.run("UPDATE payments SET status = 'mismatch', detail = ? WHERE id = ?", `Stripe reported ${session.amount_total} ${session.currency}; expected ${order.total_minor} ${order.currency}`, pay.id);
    audit(app, null, 'payment_mismatch', { order: order.number, got: session.amount_total, expected: order.total_minor });
    return 'rejected: amount mismatch';
  }
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  if (order.status === 'paid' && pay.status !== 'succeeded') {
    app.db.run("UPDATE payments SET status = 'succeeded', intent_ref = ?, detail = ? WHERE id = ?", intent, 'Duplicate payment for an already paid order: refund this in Stripe', pay.id);
    audit(app, null, 'duplicate_payment', { order: order.number, session: session.id });
    return 'duplicate payment recorded';
  }
  const r = markPaid(app, order.id, { provider: 'stripe', providerRef: session.id, intentRef: intent, detail: 'Verified by Stripe' });
  return r.ok ? 'order paid' : `rejected: ${r.reason}`;
}

function handleStripeEvent(app, event) {
  const obj = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return fulfillFromSession(app, obj);
    case 'checkout.session.async_payment_failed': {
      app.db.run("UPDATE payments SET status = 'failed' WHERE provider_ref = ? AND status = 'created'", obj.id);
      app.db.run("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'", Number(obj.client_reference_id) || 0);
      return 'order marked failed';
    }
    case 'checkout.session.expired':
      app.db.run("UPDATE payments SET status = 'expired' WHERE provider_ref = ? AND status = 'created'", obj.id);
      return 'session expired';
    case 'charge.refunded': {
      if (!obj.refunded) { audit(app, null, 'partial_refund', { intent: obj.payment_intent, amount: obj.amount_refunded }); return 'partial refund noted'; }
      const pay = app.db.get("SELECT * FROM payments WHERE intent_ref = ? AND provider = 'stripe'", obj.payment_intent);
      if (!pay) return 'ignored: unknown payment';
      refundOrder(app, pay.order_id, { detail: 'Refunded in Stripe' });
      return 'order refunded';
    }
    default:
      return 'ignored';
  }
}

// Called when the customer returns from Stripe or opens the order page: asks Stripe directly (server to server).
async function refreshCardOrder(app, order) {
  if (order.status !== 'pending' || order.method !== 'card' || !stripe.configured()) return order;
  const pays = app.db.all("SELECT * FROM payments WHERE order_id = ? AND provider = 'stripe' AND status = 'created' ORDER BY id DESC", order.id);
  for (const p of pays) {
    try {
      const session = await stripe.retrieveSession(p.provider_ref);
      if (session.payment_status === 'paid') { fulfillFromSession(app, session); break; }
      if (session.status === 'expired') app.db.run("UPDATE payments SET status = 'expired' WHERE id = ?", p.id);
    } catch (e) { console.error('[stripe] refresh failed:', e.message); }
  }
  return app.db.get('SELECT * FROM orders WHERE id = ?', order.id);
}

// ---- admin actions ------------------------------------------------------------------------------
function refundOrder(app, orderId, { detail = 'Refunded', actorId = null, ip = null } = {}) {
  app.db.tx(() => {
    const o = app.db.get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) return;
    app.db.run("UPDATE orders SET status = 'refunded' WHERE id = ?", o.id);
    app.db.run("UPDATE payments SET status = 'refunded', detail = ? WHERE order_id = ? AND status = 'succeeded'", detail, o.id);
    app.db.run('UPDATE download_grants SET revoked = 1 WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)', o.id);
    audit(app, actorId, 'order_refunded', { order: o.number }, ip);
  });
}

function cancelOrder(app, orderId, actorId, ip) {
  const o = app.db.get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o || o.status === 'paid' || o.status === 'refunded') throw new HttpError(400, 'Only unpaid orders can be cancelled.');
  app.db.run("UPDATE orders SET status = 'cancelled' WHERE id = ?", o.id);
  audit(app, actorId, 'order_cancelled', { order: o.number }, ip);
}

// ---- views --------------------------------------------------------------------------------------
function grantState(g) {
  if (!g) return { downloadable: false, reason: 'locked' };
  if (g.revoked) return { downloadable: false, reason: 'revoked' };
  if (g.expires_at && g.expires_at < now()) return { downloadable: false, reason: 'expired' };
  return { downloadable: true };
}

function orderDetail(app, order, { admin = false } = {}) {
  const paid = order.status === 'paid';
  const items = app.db.all(
    `SELECT oi.id, oi.product_id, oi.title, oi.unit_minor, g.id AS grant_id, g.max_downloads, g.revoked, g.expires_at, g.reset_at
       FROM order_items oi LEFT JOIN download_grants g ON g.order_item_id = oi.id WHERE oi.order_id = ?`, order.id,
  ).map((it) => {
    const st = grantState(it.grant_id ? it : null);
    const out = { id: it.id, product_id: it.product_id, title: it.title, unit_minor: it.unit_minor, locked: !(paid && it.grant_id), files: [] };
    if (paid && it.grant_id) {
      out.grant_id = it.grant_id;
      out.max_downloads = it.max_downloads;
      out.revoked = !!it.revoked;
      out.expires_at = it.expires_at;
      out.files = app.db.all('SELECT id, original_name, size FROM product_files WHERE product_id = ? ORDER BY id', it.product_id).map((f) => {
        const used = app.db.get('SELECT COUNT(*) AS n FROM download_log WHERE grant_id = ? AND file_id = ? AND created_at > ?', it.grant_id, f.id, it.reset_at).n;
        const left = Math.max(0, it.max_downloads - used);
        const ok = st.downloadable && left > 0;
        return { id: f.id, name: f.original_name, size: f.size, downloads_left: left, available: ok, url: ok ? `/download/${it.grant_id}/${f.id}` : null, reason: ok ? null : st.downloadable ? 'limit' : st.reason };
      });
    }
    return out;
  });
  const payments = app.db.all('SELECT id, provider, provider_ref, status, amount_minor, currency, detail, created_at FROM payments WHERE order_id = ? ORDER BY id', order.id)
    .map((p) => (admin ? p : { id: p.id, provider: p.provider, status: p.status, amount_minor: p.amount_minor, currency: p.currency, created_at: p.created_at }));
  return { ...order, items, payments };
}

function listOrders(app, userId) {
  return app.db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 200', userId).map((o) => ({
    ...o, items: app.db.all('SELECT title, unit_minor FROM order_items WHERE order_id = ?', o.id),
  }));
}

// Orders left unpaid for 48h are closed so the order list stays tidy.
function expireStaleOrders(app) {
  app.db.run("UPDATE orders SET status = 'cancelled' WHERE status = 'pending' AND created_at < ?", now() - 48 * 3600e3);
}

module.exports = {
  audit, availableMethods, createOrder, startCardPayment, markPaid, handleStripeEvent, refreshCardOrder,
  refundOrder, cancelOrder, orderDetail, listOrders, expireStaleOrders, grantState,
};
