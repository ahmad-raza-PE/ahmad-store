'use strict';
/* Browser test: drives the real storefront + admin UI in headless Chrome.
   Run: node --disable-warning=ExperimentalWarning tests/ui.js [screenshot-dir]
   Needs Playwright + Chrome (dev machine only; not required to run the shop). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const assert = require('assert');
const { chromium } = require('playwright');

const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'store-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'store-ui-'));
const WHSEC = 'whsec_ui_test';
const mock = require('./mock-stripe');

function png(w, h, fn) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1); raw[o] = 0; const [r, g, b] = fn(x, y); raw.set([r, g, b], o + 1 + x * 3); }
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

class Api {
  constructor(base) { this.base = base; this.jar = {}; this.csrf = ''; }
  async j(method, p, json, raw) {
    const h = {}; const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); if (cookie) h.cookie = cookie;
    if (method !== 'GET') h['x-csrf-token'] = this.csrf;
    let body = raw; if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); } if (raw) h['content-type'] = 'application/octet-stream';
    const r = await fetch(this.base + p, { method, headers: h, body });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); this.jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const data = await r.json().catch(() => ({})); if (data.csrf) this.csrf = data.csrf; return { status: r.status, data };
  }
}

let passed = 0; let failed = 0;
const problems = [];
async function step(name, fn) { try { await fn(); passed++; console.log(`  PASS  ${name}`); } catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${String(e.message).split('\n').slice(0, 14).join('\n        ')}`); } }

(async () => {
  const stripe = await mock.start();
  Object.assign(process.env, { DATA_DIR: DATA, BASE_URL: 'http://localhost:0', ADMIN_EMAIL: 'owner@example.test', ADMIN_PASSWORD: 'a-very-long-admin-passphrase', STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API_BASE: stripe.url, DOWNLOAD_LIMIT: '5' });
  const { createApp } = require('../server');
  const app = createApp();
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  // ---- seed realistic sample data (temp database only) --------------------------------------------------
  const admin = new Api(BASE); await admin.j('GET', '/api/me'); await admin.j('POST', '/api/auth/login', { email: 'owner@example.test', password: 'a-very-long-admin-passphrase' });
  await admin.j('PUT', '/api/admin/settings/bank', { enabled: true, show_public: true, holder: 'Ahmad Raza', bank_name: 'Sample Bank UAE', iban: 'AE070331234567890123456', swift: 'SAMPAEAA', instructions: 'Use your order number as the payment reference.' });
  await admin.j('PUT', '/api/admin/settings/tax', { rate: 5, label: 'VAT', legal_name: 'Ahmad Raza Resources', number: '100000000000003', address: 'Abu Dhabi, UAE' });
  const FILES = {};
  const seed = [
    ['Weekly Plan & Recovery Plan Excel Template', 'Excel Templates', '149.00', '249.00', 'Track 11 pipelines and 8 facilities with S-curves, daily updates and recovery planning.', 'weekly-plan.xlsx', [27, 80, 160]],
    ['Planning Engineer Master Course', 'Courses', '399.00', '', 'A structured Oil & Gas planning course with Primavera P6 files and templates.', 'course.zip', [10, 26, 51]],
    ['Engineering CV Pack (8 layouts)', 'CV Templates', '39.00', '59.00', 'Eight CV layouts for engineering roles with Word and PDF exports.', 'cv-pack.zip', [240, 162, 14]],
    ['Method Statement & ITP Library', 'Documents & Guides', '89.00', '', 'Ready-to-edit method statements, ITPs and checklists for construction.', 'library.zip', [15, 143, 82]],
  ];
  for (const [title, category, price, compare, short, file, rgb] of seed) {
    const img = (await admin.j('POST', '/api/admin/images', undefined, png(640, 400, (x, y) => [Math.min(255, rgb[0] + y / 4), Math.min(255, rgb[1] + x / 8), Math.min(255, rgb[2] + (x + y) / 12)]))).data.path;
    const p = (await admin.j('POST', '/api/admin/products', { title, category, price, compare_at: compare, short_desc: short, description: `# What is included\n\n- ${short}\n- Lifetime updates\n\nBuilt on real project experience.`, featured: true, image: img })).data.product;
    const content = crypto.randomBytes(5000); FILES[title] = crypto.createHash('sha256').update(content).digest('hex');
    await admin.j('POST', `/api/admin/products/${p.id}/files?name=${encodeURIComponent(file)}`, undefined, content);
    await admin.j('PUT', `/api/admin/products/${p.id}`, { title, category, price, compare_at: compare, short_desc: short, description: p.description, featured: true, image: img, status: 'published' });
  }

  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const issues = [];
  async function newPage(opts = {}) {
    const ctxb = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true, ...opts });
    await ctxb.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctxb.route('https://checkout.stripe.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>Stripe checkout (mock)</h1>' }));
    const page = await ctxb.newPage();
    page.on('pageerror', (e) => issues.push(`pageerror ${page.url()}: ${e.message}`));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource|ERR_FAILED|fonts\./.test(m.text())) issues.push(`console.${m.type()} ${page.url()}: ${m.text()}`); });
    return { page, ctx: ctxb };
  }
  const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `horizontal scroll on ${page.url()}`);

  console.log('\n== Storefront on desktop ==');
  const { page, ctx: cctx } = await newPage();
  await step('homepage renders hero, categories, products; screenshot', async () => {
    await page.goto(BASE + '/'); await page.waitForSelector('.product');
    assert.match(await page.textContent('h1'), /Build Better Projects/); assert.ok((await page.$$('.product')).length >= 4);
    await page.screenshot({ path: path.join(SHOTS, '01-home-desktop.png'), fullPage: true });
  });
  await step('shop: search and category filter work in the real UI', async () => {
    await page.goto(BASE + '/shop'); await page.fill('input[name=q]', 'course'); await page.click('.filters button[type=submit]'); await page.waitForURL(/q=course/);
    assert.strictEqual((await page.$$('.product')).length, 1); await page.goto(BASE + '/shop?category=CV%20Templates'); assert.strictEqual((await page.$$('.product')).length, 1);
    await page.goto(BASE + '/shop'); await page.screenshot({ path: path.join(SHOTS, '02-shop-desktop.png') });
  });
  await step('product page: price, save badge, share buttons; add to cart updates the badge', async () => {
    await page.goto(BASE + '/shop'); await page.click('.product:has-text("Weekly Plan") h3 a'); await page.waitForSelector('.pdp');
    assert.match(await page.textContent('.pdp-price'), /AED 149\.00/); assert.match(await page.textContent('.pdp-price'), /Save 40%/); assert.ok((await page.$$('.share a')).length >= 5);
    await page.screenshot({ path: path.join(SHOTS, '03-product-desktop.png'), fullPage: true });
    await page.click('.pdp [data-add]'); await page.waitForFunction(() => document.querySelector('[data-cart-count]').textContent === '1');
  });
  await step('cart shows the item and total with VAT; remove works', async () => {
    await page.goto(BASE + '/cart'); await page.waitForSelector('.cart-item'); assert.match(await page.textContent('.summary'), /AED 156\.45/);
    await page.screenshot({ path: path.join(SHOTS, '04-cart-desktop.png') });
  });
  await step('checkout asks the visitor to register; registration works in the UI', async () => {
    await page.click('text=Checkout securely'); await page.waitForSelector('#auth-slot .auth-box');
    await page.click('[data-tab=up]'); await page.fill('#f-up [name=name]', 'Layla Planner'); await page.fill('#f-up [name=email]', 'layla@example.test'); await page.fill('#f-up [name=password]', 'layla-password-1'); await page.click('#f-up button[type=submit]');
    await page.waitForSelector('.pay-opt'); assert.match(await page.textContent('.summary'), /AED 156\.45/);
    await page.screenshot({ path: path.join(SHOTS, '05-checkout-desktop.png') });
  });
  let orderNumber; let stripeSession;
  await step('card payment: order is created and the customer is sent to Stripe', async () => {
    await page.check('input[value=card]'); await Promise.all([page.waitForURL(/checkout\.stripe\.test/), page.click('#pay')]);
    stripeSession = [...stripe.sessions.values()].pop(); assert.strictEqual(stripeSession.amount_total, 15645); orderNumber = app.db.get('SELECT number FROM orders ORDER BY id DESC LIMIT 1').number;
  });
  await step('returning from Stripe BEFORE payment is verified: download stays locked', async () => {
    await page.goto(`${BASE}/order/${orderNumber}?return=1`); await page.waitForSelector('.order-box');
    assert.match(await page.textContent('#order-root'), /Confirming your payment/); assert.ok(await page.isDisabled('.order-box button.btn-primary'), 'download button is disabled'); assert.strictEqual((await page.$$('a[href^="/download/"]')).length, 0);
    await page.screenshot({ path: path.join(SHOTS, '06-order-locked-desktop.png') });
  });
  await step('after Stripe\'s signed webhook, the page unlocks by itself and the file downloads intact', async () => {
    const raw = JSON.stringify({ id: 'evt_ui_1', type: 'checkout.session.completed', data: { object: { id: stripeSession.id, client_reference_id: stripeSession.client_reference_id, payment_status: 'paid', amount_total: 15645, currency: 'aed', payment_intent: 'pi_ui_1' } } });
    const ts = Math.floor(Date.now() / 1000); const sig = crypto.createHmac('sha256', WHSEC).update(`${ts}.${raw}`).digest('hex');
    const r = await fetch(`${BASE}/webhooks/stripe`, { method: 'POST', headers: { 'stripe-signature': `t=${ts},v1=${sig}`, 'content-type': 'application/json' }, body: raw }); assert.strictEqual(r.status, 200);
    await page.waitForSelector('a[href^="/download/"]', { timeout: 20000 }); assert.match(await page.textContent('#order-root'), /Payment verified/);
    await page.screenshot({ path: path.join(SHOTS, '07-order-paid-desktop.png') });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('a[href^="/download/"]')]);
    const buf = fs.readFileSync(await dl.path()); assert.strictEqual(crypto.createHash('sha256').update(buf).digest('hex'), FILES['Weekly Plan & Recovery Plan Excel Template']); assert.strictEqual(dl.suggestedFilename(), 'weekly-plan.xlsx');
  });
  await step('receipt page renders and account page lists the order', async () => {
    await page.goto(`${BASE}/receipt/${orderNumber}`); assert.match(await page.textContent('.receipt'), /Payment receipt/); await page.screenshot({ path: path.join(SHOTS, '08-receipt-desktop.png') });
    await page.goto(BASE + '/account'); await page.waitForSelector('.tbl'); assert.match(await page.textContent('.tbl'), new RegExp(orderNumber)); await page.screenshot({ path: path.join(SHOTS, '09-account-desktop.png') });
  });
  let bankOrder;
  await step('bank transfer via the UI: details + reference shown, download locked', async () => {
    await page.goto(BASE + '/product/engineering-cv-pack-8-layouts'); await page.click('.pdp [data-buy]'); await page.waitForURL(/checkout/); await page.waitForSelector('.pay-opt');
    await page.check('input[value=bank_transfer]'); await Promise.all([page.waitForURL(/\/order\//), page.click('#pay')]); await page.waitForSelector('.bank');
    bankOrder = page.url().split('/order/')[1].split('?')[0]; const t = await page.textContent('#order-root'); assert.match(t, /AE070331234567890123456/); assert.match(t, new RegExp(bankOrder)); assert.ok(await page.isDisabled('.order-box button.btn-primary'));
    await page.screenshot({ path: path.join(SHOTS, '10-bank-order-desktop.png'), fullPage: true });
  });

  console.log('\n== Admin dashboard (real clicks) ==');
  const { page: ap } = await newPage();
  await step('admin signs in through the login form', async () => {
    await ap.goto(BASE + '/admin'); await ap.fill('input[name=email]', 'owner@example.test'); await ap.fill('input[name=password]', 'a-very-long-admin-passphrase'); await ap.click('#lf button'); await ap.waitForSelector('.adm-side');
    await ap.waitForSelector('.stat'); await ap.screenshot({ path: path.join(SHOTS, '11-admin-dashboard.png'), fullPage: true }); assert.match(await ap.textContent('.stats'), /AED 156\.45/);
  });
  await step('admin sees the bank order, confirms the transfer with a reference, downloads unlock', async () => {
    await ap.click('[data-nav=orders]'); await ap.waitForSelector(`text=${bankOrder}`); await ap.click(`tr:has-text("${bankOrder}") [data-open]`); await ap.waitForSelector('#markpaid');
    await ap.screenshot({ path: path.join(SHOTS, '12-admin-order-modal.png') });
    ap.once('dialog', (d) => d.accept()); await ap.fill('#note', 'Bank ref TRX-1001'); await ap.click('#markpaid'); await ap.waitForSelector('text=Marked as paid', { timeout: 8000 }).catch(() => {});
    await ap.waitForFunction(() => /Paid/.test(document.querySelector('.modal h2')?.textContent || '')); await ap.click('.modal .x');
    await page.reload(); await page.waitForSelector('a[href^="/download/"]'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click('a[href^="/download/"]')]);
    assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(await dl.path())).digest('hex'), FILES['Engineering CV Pack (8 layouts)']);
  });
  await step('admin product editor: create a draft product, upload a file in the UI, publish it', async () => {
    await ap.goto(BASE + '/admin#/products/new'); await ap.waitForSelector('#pf'); await ap.fill('[name=title]', 'Primavera P6 Cheat Sheet'); await ap.fill('[name=price]', '19.00'); await ap.fill('[name=short_desc]', 'One-page P6 shortcuts.');
    await ap.click('#pf button.btn-primary'); await ap.waitForSelector('#up'); const tmp = path.join(DATA, 'sheet.pdf'); fs.writeFileSync(tmp, '%PDF-1.4 sheet');
    await ap.setInputFiles('#up', tmp); await ap.waitForSelector('#files td:text-is("sheet.pdf")'); await ap.selectOption('[name=status]', 'published'); await ap.click('#pf button.btn-primary'); await ap.waitForSelector('text=View on website');
    await ap.screenshot({ path: path.join(SHOTS, '13-admin-product-editor.png'), fullPage: true });
    await page.goto(BASE + '/shop?q=cheat'); assert.strictEqual((await page.$$('.product')).length, 1);
  });
  await step('admin content + social pages save changes that appear on the website', async () => {
    await ap.goto(BASE + '/admin#/social'); await ap.waitForSelector('#sf'); await ap.fill('#wanum', '971501234567'); await ap.click('#sf button.btn-primary'); await ap.waitForSelector('.toast.show');
    await ap.screenshot({ path: path.join(SHOTS, '14-admin-social.png'), fullPage: true });
    await ap.goto(BASE + '/admin#/payments'); await ap.waitForSelector('form[data-sec=bank]'); await ap.screenshot({ path: path.join(SHOTS, '15-admin-payments.png'), fullPage: true });
    await page.goto(BASE + '/'); assert.ok(await page.$('.wa-fab'), 'WhatsApp button now visible');
  });

  console.log('\n== Mobile (iPhone-size) and tablet ==');
  const { page: mp } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await step('mobile: home, menu, shop, product and cart have no sideways scrolling', async () => {
    for (const [p, name] of [['/', '16-home-mobile'], ['/shop', '17-shop-mobile'], ['/product/weekly-plan-recovery-plan-excel-template', '18-product-mobile'], ['/faq', '19-faq-mobile']]) {
      await mp.goto(BASE + p); await mp.waitForLoadState('domcontentloaded'); await noOverflow(mp); await mp.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: p === '/' });
    }
    await mp.goto(BASE + '/'); await mp.click('.menu-btn'); assert.ok(await mp.isVisible('#nav.open')); await mp.screenshot({ path: path.join(SHOTS, '20-menu-mobile.png') });
  });
  await step('mobile checkout works end to end (bank transfer)', async () => {
    await mp.goto(BASE + '/product/method-statement-itp-library'); await mp.click('.pdp [data-buy]'); await mp.waitForSelector('#auth-slot');
    await mp.click('[data-tab=up]'); await mp.fill('#f-up [name=name]', 'Omar'); await mp.fill('#f-up [name=email]', 'omar@example.test'); await mp.fill('#f-up [name=password]', 'omar-password-1'); await mp.click('#f-up button[type=submit]');
    await mp.waitForSelector('.pay-opt'); await noOverflow(mp); await mp.screenshot({ path: path.join(SHOTS, '21-checkout-mobile.png'), fullPage: true });
    await mp.check('input[value=bank_transfer]'); await Promise.all([mp.waitForURL(/\/order\//), mp.click('#pay')]); await mp.waitForSelector('.bank'); await noOverflow(mp);
  });
  const { page: tp } = await newPage({ viewport: { width: 820, height: 1180 } });
  await step('tablet layout renders without overflow', async () => { await tp.goto(BASE + '/shop'); await tp.waitForSelector('.product'); await noOverflow(tp); await tp.screenshot({ path: path.join(SHOTS, '22-shop-tablet.png') }); });
  const { page: ma } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await step('admin works on a phone without sideways scrolling', async () => { await ma.goto(BASE + '/admin'); await ma.fill('input[name=email]', 'owner@example.test'); await ma.fill('input[name=password]', 'a-very-long-admin-passphrase'); await ma.click('#lf button'); await ma.waitForSelector('.stat'); await noOverflow(ma); await ma.screenshot({ path: path.join(SHOTS, '23-admin-mobile.png') }); });

  console.log('\n== Link check: every internal link on the main pages responds ==');
  await step('no broken internal links or buttons that point nowhere', async () => {
    const seen = new Set(); const bad = [];
    for (const start of ['/', '/shop', '/about', '/faq', '/contact', '/payments', '/tools', '/privacy', '/terms', '/product/weekly-plan-recovery-plan-excel-template']) {
      await page.goto(BASE + start); const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
      for (const h of hrefs) { if (!h || h.startsWith('#') || /^(mailto|tel|javascript):/.test(h) || /^https?:/.test(h) || seen.has(h) || h.startsWith('/download/') || h.startsWith('/receipt/') || h.startsWith('/order/')) continue; seen.add(h); const r = await fetch(BASE + h, { redirect: 'manual' }); if (r.status >= 400) bad.push(`${h} -> ${r.status}`); }
    }
    assert.deepStrictEqual(bad, [], `broken links: ${bad.join(', ')}`); console.log(`        (${seen.size} unique internal links checked)`);
  });
  await step('contact form submits from the real page and the admin sees it', async () => {
    await page.goto(BASE + '/contact'); await page.fill('#contact-form [name=name]', 'Visitor'); await page.fill('#contact-form [name=email]', 'visitor@example.test'); await page.fill('#contact-form [name=message]', 'Do you offer a team licence for the course?'); await page.click('#contact-form button'); await page.waitForSelector('.form-msg.ok');
    assert.ok((await admin.j('GET', '/api/admin/messages')).data.messages.some((m) => m.name === 'Visitor'));
  });
  await step('free EVM calculator computes SPI/CPI live', async () => {
    await page.goto(BASE + '/tools'); await page.waitForSelector('.res'); const t = await page.textContent('#evm-out'); assert.match(t, /0\.90/); assert.match(t, /0\.86/);
    await page.fill('[name=ev]', '500000'); assert.match(await page.textContent('#evm-out'), /1\.25/);
  });
  await step('no JavaScript errors or CSP violations occurred in any page', async () => { assert.deepStrictEqual(issues, [], issues.join('\n')); });

  await browser.close(); server.close(); stripe.close(); app.db.close(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('UI test crashed:', e); process.exit(2); });
