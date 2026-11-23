'use strict';
/* End-to-end test of the complete customer journey and the security rules.
   Run:  node --disable-warning=ExperimentalWarning tests/e2e.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const assert = require('assert');

const WHSEC = 'whsec_test_secret_for_unit_tests';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'store-e2e-'));
const mock = require('./mock-stripe');

// ---- fake SMTP server (captures emails so we can test receipts + password reset) ---------------------------------
function fakeSmtp() {
  const mails = [];
  const server = net.createServer((sock) => {
    let data = false; let buf = ''; let cur = { to: [], raw: '' };
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString();
      if (data) {
        if (buf.includes('\r\n.\r\n')) { cur.raw = buf.split('\r\n.\r\n')[0]; mails.push(cur); cur = { to: [], raw: '' }; buf = ''; data = false; sock.write('250 queued\r\n'); }
        return;
      }
      for (const line of buf.split('\r\n')) {
        if (!line) continue;
        if (/^EHLO/i.test(line)) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (/^MAIL FROM/i.test(line)) sock.write('250 ok\r\n');
        else if (/^RCPT TO:<(.+)>/i.test(line)) { cur.to.push(line.match(/<(.+)>/)[1]); sock.write('250 ok\r\n'); }
        else if (/^DATA/i.test(line)) { data = true; sock.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
      }
      if (!data) buf = '';
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ port: server.address().port, mails, close: () => server.close() })));
}
const mailText = (m) => Buffer.from(m.raw.split('\r\n\r\n').slice(1).join('').replace(/\s+/g, ''), 'base64').toString('utf8');

class Client {
  constructor(base) { this.base = base; this.jar = {}; this.csrf = ''; }
  async req(method, p, { json, body, headers = {} } = {}) {
    const h = { ...headers };
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    if (method !== 'GET' && this.csrf && !('x-csrf-token' in h)) h['x-csrf-token'] = this.csrf;
    let b = body;
    if (json !== undefined) { h['content-type'] = 'application/json'; b = JSON.stringify(json); }
    const r = await fetch(this.base + p, { method, headers: h, body: b, redirect: 'manual' });
    for (const sc of r.headers.getSetCookie()) {
      const [kv] = sc.split(';'); const i = kv.indexOf('=');
      if (/Max-Age=0/i.test(sc)) delete this.jar[kv.slice(0, i)]; else this.jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return r;
  }
  async json(method, p, json) { const r = await this.req(method, p, { json }); return { status: r.status, data: await r.json().catch(() => ({})), res: r }; }
  async init() { this.csrf = (await this.json('GET', '/api/me')).data.csrf; return this; }
  async login(email, password) { const r = await this.json('POST', '/api/auth/login', { email, password }); if (r.data.csrf) this.csrf = r.data.csrf; return r; }
  async register(name, email, password) { const r = await this.json('POST', '/api/auth/register', { name, email, password }); if (r.data.csrf) this.csrf = r.data.csrf; return r; }
}

function signedEvent(event, { secret = WHSEC, ts = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(event);
  return { raw, header: `t=${ts},v1=${crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')}` };
}

let passed = 0; let failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${String(e.message).split('\n').join('\n        ')}`); }
}

(async () => {
  const stripe = await mock.start();
  const smtp = await fakeSmtp();
  Object.assign(process.env, {
    DATA_DIR: DATA, BASE_URL: 'https://shop.example.test', ADMIN_EMAIL: 'owner@example.test', ADMIN_PASSWORD: 'a-very-long-admin-passphrase',
    STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API_BASE: stripe.url, DOWNLOAD_LIMIT: '3',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_SECURE: 'none', SMTP_FROM: 'Shop <shop@example.test>',
  });
  const { createApp } = require('../server');
  const app = createApp();
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const postWebhook = async (signed) => {
    const r = await fetch(`${BASE}/webhooks/stripe`, { method: 'POST', headers: { 'stripe-signature': signed.header, 'content-type': 'application/json' }, body: signed.raw });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const paidEvent = (session, overrides = {}, id = `evt_${crypto.randomBytes(6).toString('hex')}`) => ({
    id, type: 'checkout.session.completed',
    data: { object: { id: session.id, client_reference_id: session.client_reference_id, payment_status: 'paid', amount_total: session.amount_total, currency: session.currency, payment_intent: `pi_${session.id}`, ...overrides } },
  });

  const FILE = crypto.randomBytes(300 * 1024); // the "paid" deliverable
  const FILE_HASH = crypto.createHash('sha256').update(FILE).digest('hex');
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
  const ctx = {};

  console.log('\n== 1. Admin sets up the shop ==');
  const admin = await new Client(BASE).init();
  await check('admin login works; wrong password is rejected', async () => {
    const bad = await new Client(BASE).init(); assert.strictEqual((await bad.login('owner@example.test', 'wrong-password-123')).status, 401);
    const ok = await admin.login('owner@example.test', 'a-very-long-admin-passphrase'); assert.strictEqual(ok.status, 200); assert.strictEqual(ok.data.user.role, 'admin');
  });
  await check('products can be created, but not published without a file', async () => {
    const mk = await admin.json('POST', '/api/admin/products', { title: 'Weekly Plan <b>Template</b>', price: '49.00', compare_at: '79.00', category: 'Excel Templates', short_desc: 'A weekly plan tracker', description: '# What you get\n\n- Plans\n- Charts', status: 'draft', featured: true });
    assert.strictEqual(mk.status, 201, JSON.stringify(mk.data)); ctx.p1 = mk.data.product;
    const pub = await admin.json('PUT', `/api/admin/products/${ctx.p1.id}`, { ...ctx.p1, price: '49.00', status: 'published' });
    assert.strictEqual(pub.status, 400); assert.match(pub.data.error, /Upload at least one file/);
  });
  await check('price is mandatory and validated', async () => {
    assert.strictEqual((await admin.json('POST', '/api/admin/products', { title: 'No price product', price: '' })).status, 400);
    assert.strictEqual((await admin.json('POST', '/api/admin/products', { title: 'Cheap product', price: '0.50' })).status, 400);
    assert.strictEqual((await admin.json('POST', '/api/admin/products', { title: 'Weird price', price: '12abc' })).status, 400);
  });
  await check('file upload goes to private storage; dangerous types are refused', async () => {
    const up = await admin.req('POST', `/api/admin/products/${ctx.p1.id}/files?name=${encodeURIComponent('Weekly Plan.zip')}`, { body: FILE, headers: { 'content-type': 'application/octet-stream' } });
    assert.strictEqual(up.status, 201); const j = await up.json(); ctx.f1 = j.file; assert.strictEqual(j.file.size, FILE.length);
    const exe = await admin.req('POST', `/api/admin/products/${ctx.p1.id}/files?name=virus.exe`, { body: Buffer.from('MZ'), headers: { 'content-type': 'application/octet-stream' } });
    assert.strictEqual(exe.status, 400);
    const stored = fs.readdirSync(path.join(DATA, 'private')).filter((f) => !f.startsWith('.'));
    assert.strictEqual(stored.length, 1); assert.ok(/^[a-f0-9]{32}$/.test(stored[0]), 'stored under a random name, not the original name');
  });
  await check('image upload verifies the real file type', async () => {
    const good = await admin.req('POST', '/api/admin/images', { body: PNG, headers: { 'content-type': 'application/octet-stream' } });
    assert.strictEqual(good.status, 201); ctx.img = (await good.json()).path; assert.match(ctx.img, /^\/uploads\/[a-f0-9]{32}\.png$/);
    const evil = await admin.req('POST', '/api/admin/images', { body: Buffer.from('<svg onload=alert(1)>'), headers: { 'content-type': 'application/octet-stream' } });
    assert.strictEqual(evil.status, 400);
    assert.strictEqual((await fetch(BASE + ctx.img)).status, 200);
  });
  await check('product publishes once a file exists', async () => {
    const pub = await admin.json('PUT', `/api/admin/products/${ctx.p1.id}`, { title: ctx.p1.title, price: '49.00', compare_at: '79.00', category: 'Excel Templates', short_desc: 'A weekly plan tracker', description: '# What you get\n\n- Plans\n- Charts', status: 'published', featured: true, image: ctx.img });
    assert.strictEqual(pub.status, 200, JSON.stringify(pub.data)); ctx.p1 = pub.data.product; assert.strictEqual(ctx.p1.price_minor, 4900);
  });
  await check('second product (for the bank-transfer test)', async () => {
    const mk = await admin.json('POST', '/api/admin/products', { title: 'Planner CV Pack', price: '25.50', category: 'CV Templates', short_desc: 'CV templates' }); ctx.p2 = mk.data.product;
    await admin.req('POST', `/api/admin/products/${ctx.p2.id}/files?name=cv-pack.pdf`, { body: Buffer.from('%PDF-1.4 fake cv pack'), headers: { 'content-type': 'application/octet-stream' } });
    const pub = await admin.json('PUT', `/api/admin/products/${ctx.p2.id}`, { title: 'Planner CV Pack', price: '25.50', category: 'CV Templates', short_desc: 'CV templates', status: 'published' });
    assert.strictEqual(pub.status, 200);
  });
  await check('payment settings: bank details, 5% VAT, malicious links are stripped', async () => {
    assert.strictEqual((await admin.json('PUT', '/api/admin/settings/bank', { enabled: true, show_public: true, holder: 'Ahmad Raza', bank_name: 'Test Bank', iban: 'AE070331234567890123456', swift: 'TESTAEAA', instructions: 'Use order number as reference.' })).status, 200);
    assert.strictEqual((await admin.json('PUT', '/api/admin/settings/tax', { rate: 5, label: 'VAT', legal_name: 'Ahmad Raza Resources', number: '100000000000003', address: 'Abu Dhabi, UAE' })).status, 200);
    const hero = await admin.json('PUT', '/api/admin/settings/hero', { ...app.settings.get().hero, cta_link: 'javascript:alert(1)', title: 'Plan <script>alert(1)</script> better' });
    assert.strictEqual(hero.data.value.cta_link, '', 'javascript: link must be removed');
  });

  console.log('\n== 2. Public site, SEO and file privacy ==');
  const anon = await new Client(BASE).init();
  await check('home, shop, product, about, faq, contact, payments, tools, privacy, terms all render', async () => {
    for (const p of ['/', '/shop', `/product/${ctx.p1.slug}`, '/about', '/faq', '/contact', '/payments', '/tools', '/privacy', '/terms', '/cart', '/checkout', '/account']) {
      const r = await anon.req('GET', p); assert.strictEqual(r.status, 200, `${p} -> ${r.status}`);
    }
  });
  await check('HTML output escapes script injection (product title + hero text)', async () => {
    const html = await (await anon.req('GET', `/product/${ctx.p1.slug}`)).text();
    assert.ok(!html.includes('<b>Template</b>')); assert.ok(html.includes('&lt;b&gt;Template&lt;/b&gt;'));
    const home = await (await anon.req('GET', '/')).text(); assert.ok(!home.includes('<script>alert(1)</script>'));
  });
  await check('product page has SEO: title, meta description, canonical, Open Graph, Product JSON-LD with price', async () => {
    const html = await (await anon.req('GET', `/product/${ctx.p1.slug}`)).text();
    assert.match(html, /<title>[^<]*Weekly Plan/); assert.match(html, /<meta name="description"/); assert.match(html, /rel="canonical" href="https:\/\/shop\.example\.test\/product\//);
    assert.match(html, /property="og:image"/); assert.match(html, /"@type":"Product"/); assert.match(html, /"price":"49.00"/); assert.match(html, /"priceCurrency":"AED"/);
    assert.match(html, /wa\.me\/\?text=/, 'share buttons present');
  });
  await check('shop search + category filter work; sitemap and robots exist', async () => {
    assert.match(await (await anon.req('GET', '/shop?q=weekly')).text(), /Weekly Plan/);
    assert.ok(!(await (await anon.req('GET', '/shop?q=zzzznothing')).text()).includes('Weekly Plan &lt;'));
    assert.match(await (await anon.req('GET', '/shop?category=CV%20Templates')).text(), /Planner CV Pack/);
    assert.match(await (await anon.req('GET', '/sitemap.xml')).text(), new RegExp(`/product/${ctx.p1.slug}`));
    assert.match(await (await anon.req('GET', '/robots.txt')).text(), /Disallow: \/admin/);
  });
  await check('social links render with the arazasanu1 username; hero shows nothing dangerous', async () => {
    const html = await (await anon.req('GET', '/')).text();
    for (const u of ['instagram.com/arazasanu1', 'facebook.com/arazasanu1', 'tiktok.com/@arazasanu1', 'youtube.com/@arazasanu1', 't.me/arazasanu1']) assert.ok(html.includes(u), u);
  });
  await check('paid files are NOT reachable by any public URL', async () => {
    const stored = fs.readdirSync(path.join(DATA, 'private')).filter((f) => !f.startsWith('.'))[0];
    for (const p of [`/private/${stored}`, `/data/private/${stored}`, `/uploads/${stored}`, `/${stored}`, '/../data/store.sqlite', '/%2e%2e/data/store.sqlite', '/.env', '/lib/config.js', '/server.js', '/download/1/1', `/api/admin/files/${ctx.f1.id}/download`]) {
      const r = await anon.req('GET', p); assert.ok([302, 401, 403, 404].includes(r.status), `${p} -> ${r.status}`);
      const body = Buffer.from(await r.arrayBuffer()); assert.ok(!body.equals(FILE), `${p} leaked the file`);
    }
  });
  await check('security headers are present', async () => {
    const h = (await anon.req('GET', '/')).headers;
    assert.match(h.get('content-security-policy'), /frame-ancestors 'none'/); assert.strictEqual(h.get('x-content-type-options'), 'nosniff'); assert.match(h.get('strict-transport-security') || '', /max-age/); assert.strictEqual(h.get('x-frame-options'), 'DENY');
  });

  console.log('\n== 3. Customer buys by card ==');
  const alice = await new Client(BASE).init();
  await check('registration validates input, stores a hashed password, and logs in', async () => {
    assert.strictEqual((await alice.register('A', 'bad', 'short')).status, 400);
    const r = await alice.register('Alice Planner', 'alice@example.test', 'alice-password-1'); assert.strictEqual(r.status, 201);
    const row = app.db.get('SELECT password_hash FROM users WHERE email = ?', 'alice@example.test'); assert.ok(row.password_hash.startsWith('scrypt$')); assert.ok(!row.password_hash.includes('alice-password-1'));
    const dupe = await new Client(BASE).init(); assert.strictEqual((await dupe.register('Alice Two', 'ALICE@example.test', 'another-pass-1')).status, 409, 'duplicate email (case-insensitive)');
  });
  await check('checkout needs login and a valid payment method; unknown products rejected', async () => {
    assert.strictEqual((await anon.json('POST', '/api/checkout', { items: [ctx.p1.id], method: 'card' })).status, 401);
    assert.strictEqual((await alice.json('POST', '/api/checkout', { items: [], method: 'card' })).status, 400);
    assert.strictEqual((await alice.json('POST', '/api/checkout', { items: [9999], method: 'card' })).status, 400);
    assert.strictEqual((await alice.json('POST', '/api/checkout', { items: [ctx.p1.id], method: 'paypal' })).status, 400);
  });
  await check('order total comes from the DATABASE, not the browser (price tampering ignored)', async () => {
    const r = await alice.json('POST', '/api/checkout', { items: [ctx.p1.id], method: 'card', price: 1, total: 1, total_minor: 1, unit_minor: 1 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); ctx.o1 = r.data.order; assert.match(r.data.url, /^https:\/\/checkout\.stripe\.test\/pay\/cs_test_/);
    const row = app.db.get('SELECT * FROM orders WHERE number = ?', ctx.o1);
    assert.strictEqual(row.subtotal_minor, 4900); assert.strictEqual(row.tax_minor, 245); assert.strictEqual(row.total_minor, 5145); assert.strictEqual(row.status, 'pending');
    ctx.s1 = [...stripe.sessions.values()].pop();
    assert.strictEqual(ctx.s1.amount_total, 5145, 'Stripe session amount = DB price + VAT'); assert.strictEqual(ctx.s1.currency, 'aed');
  });
  await check('BEFORE payment: order is pending, files are hidden, downloads are locked', async () => {
    const d = (await alice.json('GET', `/api/orders/${ctx.o1}`)).data.order;
    assert.strictEqual(d.status, 'pending'); assert.ok(d.items.every((i) => i.locked && i.files.length === 0));
    assert.strictEqual(app.db.get('SELECT COUNT(*) AS n FROM download_grants').n, 0);
    for (const url of ['/download/1/1', `/download/1/${ctx.f1.id}`]) assert.ok([403, 404].includes((await alice.req('GET', url)).status));
  });
  await check('the browser cannot unlock the order: "refresh" asks Stripe, which says unpaid -> still locked', async () => {
    const r = await alice.json('POST', `/api/orders/${ctx.o1}/refresh`); assert.strictEqual(r.data.order.status, 'pending');
    const q = await alice.req('GET', `/order/${ctx.o1}?return=1&paid=1&status=success`); assert.strictEqual(q.status, 200);
    assert.strictEqual(app.db.get('SELECT status FROM orders WHERE number = ?', ctx.o1).status, 'pending');
  });
  await check('webhook without a signature, with a wrong signature, or an old timestamp is rejected', async () => {
    const ev = paidEvent(ctx.s1);
    const none = await fetch(`${BASE}/webhooks/stripe`, { method: 'POST', body: JSON.stringify(ev) }); assert.strictEqual(none.status, 400);
    assert.strictEqual((await postWebhook(signedEvent(ev, { secret: 'whsec_attacker_guess' }))).status, 400);
    assert.strictEqual((await postWebhook(signedEvent(ev, { ts: Math.floor(Date.now() / 1000) - 3600 }))).status, 400);
    const tampered = signedEvent(ev); tampered.raw = tampered.raw.replace('"amount_total":5145', '"amount_total":1');
    assert.strictEqual((await postWebhook(tampered)).status, 400, 'body altered after signing');
    assert.strictEqual(app.db.get('SELECT status FROM orders WHERE number = ?', ctx.o1).status, 'pending');
  });
  await check('correctly signed event with the WRONG amount does not unlock anything', async () => {
    const r = await postWebhook(signedEvent(paidEvent(ctx.s1, { amount_total: 100 }))); assert.strictEqual(r.status, 200); assert.match(r.data.outcome, /mismatch/);
    assert.strictEqual(app.db.get('SELECT status FROM orders WHERE number = ?', ctx.o1).status, 'pending'); assert.strictEqual(app.db.get('SELECT COUNT(*) AS n FROM download_grants').n, 0);
  });
  await check('correctly signed event for a session this shop never created is ignored', async () => {
    const r = await postWebhook(signedEvent(paidEvent({ id: 'cs_test_forged', client_reference_id: String(app.db.get('SELECT id FROM orders WHERE number = ?', ctx.o1).id), amount_total: 5145, currency: 'aed' })));
    assert.match(r.data.outcome, /unknown session/); assert.strictEqual(app.db.get('SELECT status FROM orders WHERE number = ?', ctx.o1).status, 'pending');
  });
  await check('"unpaid" completed event does not unlock', async () => {
    const r = await postWebhook(signedEvent(paidEvent(ctx.s1, { payment_status: 'unpaid' }))); assert.match(r.data.outcome, /not paid/);
    assert.strictEqual(app.db.get('SELECT status FROM orders WHERE number = ?', ctx.o1).status, 'pending');
  });
  await check('another customer cannot see or download Alice\'s order', async () => {
    const eve = await new Client(BASE).init(); await eve.register('Eve', 'eve@example.test', 'eve-password-1');
    assert.strictEqual((await eve.json('GET', `/api/orders/${ctx.o1}`)).status, 404); assert.strictEqual((await eve.req('GET', `/order/${ctx.o1}`)).status, 404);
    assert.strictEqual((await eve.req('GET', `/receipt/${ctx.o1}`)).status, 404); assert.strictEqual((await eve.json('POST', `/api/orders/${ctx.o1}/pay`)).status, 404);
  });

  console.log('\n== 4. Verified payment unlocks the download ==');
  await check('signed Stripe event with correct amount marks the order paid and creates the download permission', async () => {
    ctx.evt = paidEvent(ctx.s1); const r = await postWebhook(signedEvent(ctx.evt)); assert.strictEqual(r.status, 200); assert.strictEqual(r.data.outcome, 'order paid');
    const o = app.db.get('SELECT * FROM orders WHERE number = ?', ctx.o1); assert.strictEqual(o.status, 'paid'); assert.ok(o.paid_at);
    assert.strictEqual(app.db.get("SELECT status FROM payments WHERE provider_ref = ?", ctx.s1.id).status, 'succeeded');
    assert.strictEqual(app.db.get('SELECT COUNT(*) AS n FROM download_grants').n, 1);
  });
  await check('customer now sees unlocked files with a secure link', async () => {
    const d = (await alice.json('GET', `/api/orders/${ctx.o1}`)).data.order; assert.strictEqual(d.status, 'paid');
    const f = d.items[0].files[0]; assert.strictEqual(f.name, 'Weekly Plan.zip'); assert.ok(f.available); assert.match(f.url, /^\/download\/\d+\/\d+$/); assert.strictEqual(f.downloads_left, 3); ctx.dl = f.url;
  });
  await check('customer downloads the EXACT purchased file (byte-for-byte)', async () => {
    const r = await alice.req('GET', ctx.dl); assert.strictEqual(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="Weekly Plan.zip"/); assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff'); assert.match(r.headers.get('cache-control'), /no-store/);
    const body = Buffer.from(await r.arrayBuffer()); assert.strictEqual(crypto.createHash('sha256').update(body).digest('hex'), FILE_HASH);
  });
  await check('download link is useless without being signed in as the owner', async () => {
    assert.strictEqual((await anon.req('GET', ctx.dl)).status, 302, 'anonymous is sent to sign in');
    const eve = await new Client(BASE).init(); await eve.login('eve@example.test', 'eve-password-1'); assert.strictEqual((await eve.req('GET', ctx.dl)).status, 404);
  });
  await check('download allowance is enforced (3 per file), admin can reset it, revoke and restore', async () => {
    assert.strictEqual((await alice.req('GET', ctx.dl)).status, 200); assert.strictEqual((await alice.req('GET', ctx.dl)).status, 200);
    const blocked = await alice.req('GET', ctx.dl); assert.strictEqual(blocked.status, 403); assert.match(await blocked.text(), /Download limit reached/);
    const gid = app.db.get('SELECT id FROM download_grants').id;
    assert.strictEqual((await alice.json('POST', `/api/admin/grants/${gid}`, { action: 'reset' })).status, 403, 'customer cannot reset');
    assert.strictEqual((await admin.json('POST', `/api/admin/grants/${gid}`, { action: 'reset' })).status, 200); assert.strictEqual((await alice.req('GET', ctx.dl)).status, 200);
    await admin.json('POST', `/api/admin/grants/${gid}`, { action: 'revoke' }); assert.strictEqual((await alice.req('GET', ctx.dl)).status, 403);
    await admin.json('POST', `/api/admin/grants/${gid}`, { action: 'restore' }); assert.strictEqual((await alice.req('GET', ctx.dl)).status, 200);
    await admin.json('POST', `/api/admin/grants/${gid}`, { action: 'extend', amount: 5 });
  });
  await check('replayed webhook is idempotent; a second payment for a paid order is flagged, not double-fulfilled', async () => {
    const again = await postWebhook(signedEvent(ctx.evt)); assert.strictEqual(again.data.duplicate, true);
    assert.strictEqual(app.db.get('SELECT COUNT(*) AS n FROM download_grants').n, 1);
    const retry = await alice.json('POST', `/api/orders/${ctx.o1}/pay`); assert.strictEqual(retry.status, 400, 'paid order cannot be paid again');
  });
  await check('order confirmation email was sent through SMTP', async () => {
    await wait(300); const m = smtp.mails.find((x) => /Order AR-/.test(Buffer.from(x.raw.match(/Subject: =\?UTF-8\?B\?(.+?)\?=/)?.[1] || '', 'base64').toString()));
    assert.ok(m, 'confirmation mail'); assert.deepStrictEqual(m.to, ['alice@example.test']); const t = mailText(m); assert.match(t, new RegExp(ctx.o1)); assert.match(t, /AED 51\.45/); assert.ok(!/download\/\d/.test(t), 'no direct file link in email');
  });
  await check('receipt shows seller, buyer, VAT, totals and PAID', async () => {
    const html = await (await alice.req('GET', `/receipt/${ctx.o1}`)).text();
    assert.match(html, /Payment receipt/); assert.match(html, /PAID/); assert.match(html, /AED 51\.45/); assert.match(html, /VAT \(5%\)/); assert.match(html, /100000000000003/); assert.match(html, /Alice Planner/);
  });
  await check('customer cannot buy the same product twice', async () => {
    const r = await alice.json('POST', '/api/checkout', { items: [ctx.p1.id], method: 'card' }); assert.strictEqual(r.status, 409);
  });

  console.log('\n== 5. Bank transfer ==');
  await check('bank order shows details + reference, files stay locked until admin verifies', async () => {
    const r = await alice.json('POST', '/api/checkout', { items: [ctx.p2.id], method: 'bank_transfer' }); assert.strictEqual(r.status, 200); ctx.o2 = r.data.order; assert.ok(!r.data.url);
    const d = (await alice.json('GET', `/api/orders/${ctx.o2}`)).data.order; assert.strictEqual(d.status, 'awaiting_transfer'); assert.strictEqual(d.bank.iban, 'AE070331234567890123456'); assert.ok(d.items.every((i) => i.locked));
    assert.strictEqual(d.total_minor, 2678, '25.50 + 5% VAT (1.275 -> 1.28) = 26.78');
    assert.ok(!(await (await alice.req('GET', `/api/orders/${ctx.o2}`)).text()).includes('download/'));
  });
  await check('customers cannot mark their own order paid; admin must verify with a reference', async () => {
    const id = app.db.get('SELECT id FROM orders WHERE number = ?', ctx.o2).id;
    assert.strictEqual((await alice.json('POST', `/api/admin/orders/${id}/mark-paid`, { note: 'I paid' })).status, 403);
    assert.strictEqual((await admin.json('POST', `/api/admin/orders/${id}/mark-paid`, { note: '' })).status, 400, 'reference required');
    const ok = await admin.json('POST', `/api/admin/orders/${id}/mark-paid`, { note: 'Bank ref TRX-889912' }); assert.strictEqual(ok.status, 200); assert.strictEqual(ok.data.order.status, 'paid');
    const d = (await alice.json('GET', `/api/orders/${ctx.o2}`)).data.order; assert.ok(d.items[0].files[0].available);
    const dl = await alice.req('GET', d.items[0].files[0].url); assert.strictEqual(dl.status, 200); assert.strictEqual((await dl.text()), '%PDF-1.4 fake cv pack');
  });
  await check('bank details appear on the public Payment methods page', async () => {
    assert.match(await (await anon.req('GET', '/payments')).text(), /AE070331234567890123456/);
  });

  console.log('\n== 6. Server-side confirmation, failures and refunds ==');
  const bob = await new Client(BASE).init(); await bob.register('Bob', 'bob@example.test', 'bob-password-1');
  await check('server-to-server check: wrong amount is rejected; a retried payment with the right amount is confirmed (webhook delayed)', async () => {
    const r = await bob.json('POST', '/api/checkout', { items: [ctx.p1.id], method: 'card' }); ctx.o3 = r.data.order; ctx.s3 = [...stripe.sessions.values()].pop();
    ctx.s3.payment_status = 'paid'; ctx.s3.status = 'complete'; ctx.s3.amount_total = 1; // Stripe "says" paid, but the amount is wrong
    assert.strictEqual((await bob.json('POST', `/api/orders/${ctx.o3}/refresh`)).data.order.status, 'pending', 'wrong amount rejected');
    assert.strictEqual(app.db.get('SELECT COUNT(*) AS n FROM download_grants WHERE user_id = (SELECT id FROM users WHERE email = ?)', 'bob@example.test').n, 0);
    const retry = await bob.json('POST', `/api/orders/${ctx.o3}/pay`); assert.strictEqual(retry.status, 200, 'customer can retry payment on a pending order');
    const s3b = [...stripe.sessions.values()].pop(); assert.notStrictEqual(s3b.id, ctx.s3.id);
    s3b.payment_status = 'paid'; s3b.status = 'complete'; s3b.payment_intent = 'pi_bob';
    assert.strictEqual((await bob.json('POST', `/api/orders/${ctx.o3}/refresh`)).data.order.status, 'paid');
  });
  await check('refund webhook revokes access', async () => {
    const dl = (await bob.json('GET', `/api/orders/${ctx.o3}`)).data.order.items[0].files[0].url; assert.strictEqual((await bob.req('GET', dl)).status, 200);
    const r = await postWebhook(signedEvent({ id: 'evt_refund_1', type: 'charge.refunded', data: { object: { refunded: true, payment_intent: 'pi_bob', amount_refunded: 5145 } } })); assert.strictEqual(r.data.outcome, 'order refunded');
    assert.strictEqual((await bob.req('GET', dl)).status, 403); assert.strictEqual(app.db.get('SELECT status FROM orders WHERE number = ?', ctx.o3).status, 'refunded');
  });
  await check('a failed card start (Stripe down) does not leave a payable order', async () => {
    const saved = process.env.STRIPE_API_BASE; const cfg = require('../lib/config'); const old = cfg.STRIPE_API_BASE; cfg.STRIPE_API_BASE = 'http://127.0.0.1:1';
    const carl = await new Client(BASE).init(); await carl.register('Carl', 'carl@example.test', 'carl-password-1');
    const r = await carl.json('POST', '/api/checkout', { items: [ctx.p2.id], method: 'card' }); cfg.STRIPE_API_BASE = old; assert.strictEqual(r.status, 502);
    assert.strictEqual(app.db.get("SELECT status FROM orders WHERE user_id = (SELECT id FROM users WHERE email='carl@example.test')").status, 'cancelled'); assert.ok(saved);
  });

  console.log('\n== 7. Admin dashboard ==');
  await check('stats, sales reports and CSV export agree with the orders', async () => {
    const s = (await admin.json('GET', '/api/admin/stats')).data;
    assert.strictEqual(s.revenue_minor, 5145 + 2678, 'revenue = paid orders only (refunded excluded)'); assert.strictEqual(s.paid_orders, 2); assert.ok(s.top.length >= 1); assert.strictEqual(s.counts.refunded, 1);
    const csv = await (await admin.req('GET', '/api/admin/orders.csv')).text(); assert.match(csv, new RegExp(ctx.o1)); assert.match(csv, /"Order","Date","Status"/);
  });
  await check('admin can view orders, order detail with payments + download log, and customers', async () => {
    assert.ok((await admin.json('GET', '/api/admin/orders?status=paid')).data.orders.length === 2);
    const id = app.db.get('SELECT id FROM orders WHERE number = ?', ctx.o1).id; const d = (await admin.json('GET', `/api/admin/orders/${id}`)).data.order;
    assert.ok(d.payments.length >= 1 && d.downloads.length >= 4 && d.customer.email === 'alice@example.test');
    assert.ok((await admin.json('GET', '/api/admin/customers')).data.customers.length >= 3);
  });
  await check('admin can edit price/content and the change shows on the site', async () => {
    const r = await admin.json('PUT', `/api/admin/products/${ctx.p2.id}`, { title: 'Planner CV Pack', price: '30.00', category: 'CV Templates', short_desc: 'Updated blurb', status: 'published' }); assert.strictEqual(r.status, 200);
    assert.match(await (await anon.req('GET', '/shop')).text(), /AED 30\.00/);
  });
  await check('deleting a sold product archives it (customers keep downloads); unsold one is deleted', async () => {
    const del = await admin.json('DELETE', `/api/admin/products/${ctx.p1.id}`); assert.strictEqual(del.data.archived, true);
    assert.strictEqual((await anon.req('GET', `/product/${ctx.p1.slug}`)).status, 404); assert.strictEqual((await alice.req('GET', ctx.dl)).status, 200, 'Alice can still download');
    const tmp = (await admin.json('POST', '/api/admin/products', { title: 'Temp product', price: '5.00' })).data.product; assert.strictEqual((await admin.json('DELETE', `/api/admin/products/${tmp.id}`)).data.deleted, true);
  });
  await check('site content + social links can be edited without code', async () => {
    assert.strictEqual((await admin.json('PUT', '/api/admin/settings/social', { ...app.settings.get().social, whatsapp: { enabled: true, url: 'https://wa.me/971501234567' }, instagram: { enabled: false, url: 'https://www.instagram.com/arazasanu1' } })).status, 200);
    const html = await (await anon.req('GET', '/')).text(); assert.match(html, /wa-fab/); assert.ok(!html.includes('aria-label="Instagram"'));
    await admin.json('PUT', '/api/admin/settings/analytics', { ga_id: 'G-TEST123456' });
    assert.match(await (await anon.req('GET', '/')).text(), /id="cookie"/); assert.match(await (await anon.req('GET', '/js/analytics.js')).text(), /G-TEST123456/);
    assert.strictEqual((await admin.json('PUT', '/api/admin/settings/analytics', { ga_id: '"><script>' })).status, 400);
  });

  console.log('\n== 8. Security: access control, CSRF, brute force ==');
  await check('admin API refuses anonymous visitors and ordinary customers', async () => {
    for (const p of ['/api/admin/stats', '/api/admin/products', '/api/admin/orders', '/api/admin/settings', '/api/admin/orders.csv', '/api/admin/customers']) {
      assert.strictEqual((await anon.json('GET', p)).status, 401, p); assert.strictEqual((await alice.json('GET', p)).status, 403, p);
    }
    assert.strictEqual((await alice.json('POST', '/api/admin/products', { title: 'Hack', price: '1.00' })).status, 403);
  });
  await check('CSRF: state-changing requests without the token or from another origin are blocked', async () => {
    assert.strictEqual((await alice.req('POST', '/api/checkout', { json: { items: [ctx.p2.id], method: 'bank_transfer' }, headers: { 'x-csrf-token': 'wrong' } })).status, 403);
    assert.strictEqual((await alice.req('POST', '/api/checkout', { json: { items: [ctx.p2.id], method: 'bank_transfer' }, headers: { 'x-csrf-token': alice.csrf, origin: 'https://evil.example' } })).status, 403);
    const noToken = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie: Object.entries(alice.jar).map(([k, v]) => `${k}=${v}`).join('; ') } }); assert.strictEqual(noToken.status, 403);
  });
  await check('session cookie is HttpOnly + SameSite; logout really ends the session', async () => {
    const r = await new Client(BASE).init(); const res = await r.req('POST', '/api/auth/login', { json: { email: 'bob@example.test', password: 'bob-password-1' } }); r.csrf = (await res.clone().json()).csrf;
    const sc = res.headers.getSetCookie().find((c) => c.startsWith('sid=')); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/); assert.match(sc, /Secure/, 'Secure flag on https BASE_URL');
    const stolen = r.jar.sid; assert.strictEqual((await r.json('POST', '/api/auth/logout')).status, 200); const replay = new Client(BASE); replay.jar.sid = stolen; assert.strictEqual((await replay.json('GET', '/api/me')).data.user, null);
  });
  await check('login brute force is rate limited', async () => {
    const x = await new Client(BASE).init(); let last = 0;
    for (let i = 0; i < 10; i++) last = (await x.login('victim@example.test', `wrong-${i}`)).status; assert.strictEqual(last, 429);
  });
  await check('contact form stores messages and ignores bots (honeypot)', async () => {
    assert.strictEqual((await anon.json('POST', '/api/contact', { name: 'Zed', email: 'zed@example.test', subject: 'Hello', message: 'I have a question about bank transfer.' })).status, 200);
    await anon.json('POST', '/api/contact', { name: 'Bot', email: 'bot@example.test', message: 'buy cheap stuff now please', website: 'http://spam' });
    const msgs = (await admin.json('GET', '/api/admin/messages')).data.messages; assert.ok(msgs.some((m) => m.name === 'Zed')); assert.ok(!msgs.some((m) => m.name === 'Bot'));
  });
  await check('password reset by email works and signs out old sessions', async () => {
    const x = await new Client(BASE).init(); assert.strictEqual((await x.json('POST', '/api/auth/forgot', { email: 'bob@example.test' })).status, 200); await wait(300);
    const m = smtp.mails.filter((y) => y.to.includes('bob@example.test')).pop(); const token = mailText(m).match(/token=([\w-]+)/)[1];
    assert.strictEqual((await x.json('POST', '/api/auth/reset', { token: 'nope', password: 'brand-new-pass-1' })).status, 400);
    assert.strictEqual((await x.json('POST', '/api/auth/reset', { token, password: 'brand-new-pass-1' })).status, 200);
    assert.strictEqual((await x.json('POST', '/api/auth/reset', { token, password: 'again-new-pass-1' })).status, 400, 'token is single use');
    assert.strictEqual((await new Client(BASE).init().then((c) => c.login('bob@example.test', 'brand-new-pass-1'))).status, 200);
  });

  server.close(); stripe.close(); smtp.close(); app.db.close();
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('Test run crashed:', e); process.exit(2); });
