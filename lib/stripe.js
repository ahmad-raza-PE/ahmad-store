'use strict';
/* Thin Stripe client using only fetch + crypto. Prices are never taken from the browser:
   the server builds the Checkout Session from database prices and later verifies the webhook. */
const crypto = require('crypto');
const cfg = require('./config');
const { safeEq } = require('./util');

function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((x, i) => (typeof x === 'object' ? flatten(x, `${key}[${i}]`, out) : out.push([`${key}[${i}]`, String(x)])));
    } else if (typeof v === 'object') flatten(v, key, out);
    else out.push([key, String(v)]);
  }
  return out;
}

async function api(method, path, params) {
  let url = cfg.STRIPE_API_BASE + path;
  const opts = { method, headers: { Authorization: `Bearer ${cfg.STRIPE_SECRET_KEY}` }, signal: AbortSignal.timeout(20000) };
  if (params) {
    const body = new URLSearchParams(flatten(params)).toString();
    if (method === 'GET') url += `?${body}`;
    else { opts.body = body; opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  }
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Stripe request failed (${res.status})`);
  return json;
}

const configured = () => Boolean(cfg.STRIPE_SECRET_KEY && cfg.STRIPE_WEBHOOK_SECRET);

async function createCheckoutSession({ order, items, taxLabel, email, successUrl, cancelUrl }) {
  const cur = order.currency.toLowerCase();
  const line_items = items.map((it) => ({
    quantity: 1,
    price_data: { currency: cur, unit_amount: it.unit_minor, product_data: { name: it.title } },
  }));
  if (order.tax_minor > 0) {
    line_items.push({
      quantity: 1,
      price_data: { currency: cur, unit_amount: order.tax_minor, product_data: { name: `${taxLabel} (${order.tax_rate}%)` } },
    });
  }
  return api('POST', '/v1/checkout/sessions', {
    mode: 'payment',
    client_reference_id: String(order.id),
    customer_email: email,
    success_url: successUrl,
    cancel_url: cancelUrl,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    metadata: { order_id: order.id, order_number: order.number },
    payment_intent_data: { description: `Order ${order.number}`, metadata: { order_id: order.id, order_number: order.number } },
    line_items,
  });
}

const retrieveSession = (id) => api('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);

// Verifies the Stripe-Signature header (HMAC-SHA256 over "<timestamp>.<raw body>") with a replay window.
function verifyWebhook(rawBody, header, secret = cfg.STRIPE_WEBHOOK_SECRET, toleranceSec = 300) {
  if (!secret) throw new Error('Webhook secret is not configured');
  const parts = String(header || '').split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length) throw new Error('Missing signature');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  if (!sigs.some((s) => safeEq(s, expected))) throw new Error('Invalid signature');
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) throw new Error('Timestamp outside tolerance');
  return JSON.parse(rawBody.toString('utf8'));
}

module.exports = { configured, createCheckoutSession, retrieveSession, verifyWebhook };
