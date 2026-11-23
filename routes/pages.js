'use strict';
const cfg = require('../lib/config');
const orders = require('../lib/orders');
const { layout, productCard, socialLinks, shareButtons, icon, UI, abs, richText } = require('../lib/views');
const { esc, money, HttpError } = require('../lib/util');

const PAGE_SIZE = 12;
const HERO_ART = `<svg viewBox="0 0 900 460" preserveAspectRatio="xMaxYMid slice" role="presentation">
  <defs><pattern id="g" width="45" height="45" patternUnits="userSpaceOnUse"><path d="M45 0H0V45" fill="none" stroke="#fff" stroke-opacity=".05"/></pattern></defs>
  <rect width="900" height="460" fill="url(#g)"/>
  <g fill="#fff" fill-opacity=".05"><rect x="610" y="190" width="70" height="270"/><rect x="700" y="130" width="60" height="330"/><rect x="780" y="230" width="90" height="230"/><rect x="540" y="260" width="50" height="200"/></g>
  <path d="M20 400C200 370 330 250 520 170S780 90 880 80" fill="none" stroke="#f0a20e" stroke-width="3" stroke-dasharray="9 8" stroke-opacity=".9"/>
  <path d="M20 410C180 400 300 330 440 290S640 210 720 190" fill="none" stroke="#fff" stroke-width="4" stroke-opacity=".75" stroke-linecap="round"/>
  <text x="520" y="150" fill="#f0a20e" fill-opacity=".85" font-size="22" font-family="Barlow Condensed,Arial Narrow,sans-serif" letter-spacing="1">PLANNED</text>
  <text x="470" y="290" fill="#fff" fill-opacity=".75" font-size="22" font-family="Barlow Condensed,Arial Narrow,sans-serif" letter-spacing="1">ACTUAL</text></svg>`;

module.exports = function register(app) {
  const { db, settings } = app;
  const cur = () => settings.get().site.currency;
  const page = (c, o) => c.html(layout(app, o));

  const published = "p.status = 'published' AND EXISTS (SELECT 1 FROM product_files f WHERE f.product_id = p.id)";

  app.notFound = (c) => c.html(layout(app, { title: 'Page not found', noindex: true, page: 'error', path: c.url.pathname,
    body: `<section class="wrap narrow center pad"><h1>Page not found</h1><p class="lead">The page you are looking for does not exist or has moved.</p><p><a class="btn btn-primary" href="/shop">Browse the shop</a> <a class="btn btn-ghost" href="/">Go home</a></p></section>` }), 404);

  app.errorPage = ({ res, req }, status, message) => {
    const html = layout(app, { title: 'Something went wrong', noindex: true, page: 'error', path: '/',
      body: `<section class="wrap narrow center pad"><h1>${status === 403 ? 'Access denied' : status === 404 ? 'Not found' : 'Something went wrong'}</h1><p class="lead">${esc(message)}</p><p><a class="btn btn-primary" href="/account">My account</a> <a class="btn btn-ghost" href="/">Go home</a></p></section>` });
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : html);
  };

  // ---- home --------------------------------------------------------------------------------------------
  app.route('GET', '/', (c) => {
    const s = settings.get();
    let featured = db.all(`SELECT p.* FROM products p WHERE ${published} AND p.featured = 1 ORDER BY p.id DESC LIMIT 6`);
    if (!featured.length) featured = db.all(`SELECT p.* FROM products p WHERE ${published} ORDER BY p.id DESC LIMIT 6`);
    const counts = Object.fromEntries(db.all(`SELECT p.category, COUNT(*) AS n FROM products p WHERE ${published} GROUP BY p.category`).map((r) => [r.category, r.n]));
    const catTiles = s.categories.map((k) => `<a class="tile" href="/shop?category=${encodeURIComponent(k)}"><span class="tile-ico">${UI.file}</span><strong>${esc(k)}</strong><small>${counts[k] ? `${counts[k]} product${counts[k] > 1 ? 's' : ''}` : 'Coming soon'}</small></a>`).join('');
    const productsHtml = featured.length
      ? `<div class="grid">${featured.map((p) => productCard(p, s.site.currency)).join('')}</div>`
      : `<div class="empty"><h3>Products are on the way</h3><p class="muted">The shop is being stocked. Follow on social media or check back soon.</p></div>`;
    const body = `
<section class="hero"><div class="hero-art">${HERO_ART}</div><div class="wrap hero-in">
  <span class="eyebrow-line">${esc(s.hero.eyebrow)}</span>
  <h1>${esc(s.hero.title)}</h1>
  <p class="lead">${esc(s.hero.subtitle)}</p>
  <div class="cta"><a class="btn btn-amber" href="${esc(s.hero.cta_link)}">${esc(s.hero.cta_text)}</a>${s.hero.cta2_text ? `<a class="btn btn-ghost-l" href="${esc(s.hero.cta2_link)}">${esc(s.hero.cta2_text)}</a>` : ''}</div>
  <ul class="trust"><li>${UI.lock} Secure checkout</li><li>${UI.bolt} Instant delivery after payment</li><li>${UI.shield} Payments verified on our server</li></ul>
</div></section>
<section class="wrap section"><div class="sec-head"><div><span class="eyebrow">Browse</span><h2>Find what you need</h2></div><a class="more" href="/shop">View all products</a></div><div class="tiles">${catTiles}</div></section>
<section class="band-soft"><div class="wrap section"><div class="sec-head"><div><span class="eyebrow">${featured.length && featured.some((p) => p.featured) ? 'Featured' : 'Latest'}</span><h2>Popular downloads</h2></div><a class="more" href="/shop">Shop everything</a></div>${productsHtml}</div></section>
<section class="wrap section"><div class="sec-head"><div><span class="eyebrow">Simple &amp; safe</span><h2>How buying works</h2></div></div>
  <ol class="steps"><li><b>1</b><h3>Choose</h3><p class="muted">Pick a product and add it to your cart.</p></li><li><b>2</b><h3>Pay securely</h3><p class="muted">Pay by card or bank transfer.</p></li><li><b>3</b><h3>We verify</h3><p class="muted">Payment is confirmed on our server, not in your browser.</p></li><li><b>4</b><h3>Download</h3><p class="muted">Your files unlock automatically in your account.</p></li></ol></section>
${s.promo.enabled ? `<section class="promo"><div class="wrap promo-in"><div><h2>${esc(s.promo.title)}</h2><p>${esc(s.promo.text)}</p></div>${s.promo.cta_text ? `<a class="btn btn-amber" href="${esc(s.promo.cta_link || '/faq')}">${esc(s.promo.cta_text)}</a>` : ''}</div></section>` : ''}
<section class="wrap section"><div class="split"><div><span class="eyebrow">Free</span><h2>Planning tools you can use now</h2><p class="muted">Calculate SPI, CPI, EAC, ETC and TCPI instantly with the free earned-value calculator.</p><p><a class="btn btn-primary" href="/tools">Open free tools</a></p></div>
  <div><span class="eyebrow">Questions</span><h2>Quick answers</h2>${s.faq.slice(0, 3).map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}<p><a class="more" href="/faq">All questions</a></p></div></div></section>`;
    page(c, { path: '/', page: 'home', body, jsonld: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: s.site.name, url: cfg.BASE_URL, potentialAction: { '@type': 'SearchAction', target: `${cfg.BASE_URL}/shop?q={search_term_string}`, 'query-input': 'required name=search_term_string' } }] });
  });

  // ---- shop ---------------------------------------------------------------------------------------------
  app.route('GET', '/shop', (c) => {
    const s = settings.get();
    const q = String(c.query.q || '').trim().slice(0, 80);
    const category = String(c.query.category || '').trim().slice(0, 60);
    const sort = ['newest', 'price_asc', 'price_desc', 'popular'].includes(c.query.sort) ? c.query.sort : 'newest';
    const pg = Math.max(1, parseInt(c.query.page, 10) || 1);
    const where = [published];
    const args = [];
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      where.push("(p.title LIKE ? ESCAPE '\\' OR p.short_desc LIKE ? ESCAPE '\\' OR p.tags LIKE ? ESCAPE '\\' OR p.category LIKE ? ESCAPE '\\')");
      args.push(like, like, like, like);
    }
    if (category) { where.push('p.category = ?'); args.push(category); }
    const order = { newest: 'p.id DESC', price_asc: 'p.price_minor ASC', price_desc: 'p.price_minor DESC',
      popular: "(SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status = 'paid') DESC, p.id DESC" }[sort];
    const total = db.get(`SELECT COUNT(*) AS n FROM products p WHERE ${where.join(' AND ')}`, ...args).n;
    const rows = db.all(`SELECT p.* FROM products p WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, PAGE_SIZE, (pg - 1) * PAGE_SIZE);
    const cats = db.all(`SELECT p.category, COUNT(*) AS n FROM products p WHERE ${published} GROUP BY p.category ORDER BY p.category`);
    const qs = (o) => { const u = new URLSearchParams({ ...(q && { q }), ...(category && { category }), ...(sort !== 'newest' && { sort }), ...o }); [...u].forEach(([k, v]) => { if (!v) u.delete(k); }); const t = u.toString(); return `/shop${t ? `?${t}` : ''}`; };
    const pages = Math.ceil(total / PAGE_SIZE);
    const body = `
<section class="page-head"><div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <span>Shop</span></nav><h1>${category ? esc(category) : 'Shop'}</h1><p class="lead muted">Digital products for planners, project controllers and engineers. Instant download after verified payment.</p></div></section>
<section class="wrap section tight">
  <form class="filters" method="get" action="/shop" role="search">
    <input type="search" name="q" value="${esc(q)}" placeholder="Search products" aria-label="Search products">
    <select name="category" aria-label="Category"><option value="">All categories</option>${cats.map((k) => `<option value="${esc(k.category)}"${k.category === category ? ' selected' : ''}>${esc(k.category)} (${k.n})</option>`).join('')}</select>
    <select name="sort" aria-label="Sort by"><option value="newest"${sort === 'newest' ? ' selected' : ''}>Newest</option><option value="popular"${sort === 'popular' ? ' selected' : ''}>Most popular</option><option value="price_asc"${sort === 'price_asc' ? ' selected' : ''}>Price: low to high</option><option value="price_desc"${sort === 'price_desc' ? ' selected' : ''}>Price: high to low</option></select>
    <button class="btn btn-primary" type="submit">Search</button>
  </form>
  <div class="chips"><a class="chip${category ? '' : ' on'}" href="${qs({ category: '', page: '' })}">All</a>${cats.map((k) => `<a class="chip${k.category === category ? ' on' : ''}" href="${qs({ category: k.category, page: '' })}">${esc(k.category)}</a>`).join('')}</div>
  <p class="muted result-count">${total} product${total === 1 ? '' : 's'}${q ? ` for "${esc(q)}"` : ''}</p>
  ${rows.length ? `<div class="grid">${rows.map((p) => productCard(p, s.site.currency)).join('')}</div>` : `<div class="empty"><h3>Nothing found</h3><p class="muted">Try a different search or <a href="/shop">view all products</a>.</p></div>`}
  ${pages > 1 ? `<nav class="pager" aria-label="Pages">${Array.from({ length: pages }, (_, i) => `<a class="chip${i + 1 === pg ? ' on' : ''}" href="${qs({ page: i + 1 })}">${i + 1}</a>`).join('')}</nav>` : ''}
</section>`;
    page(c, { title: category ? `${category} | Shop` : 'Shop', description: 'Browse planning engineering Excel templates, courses, CV templates and guides. Pay securely and download instantly.', path: '/shop', page: 'shop', body, noindex: Boolean(q) });
  });

  // ---- product detail -----------------------------------------------------------------------------------
  app.route('GET', '/product/:slug', (c) => {
    const s = settings.get();
    const p = db.get(`SELECT p.* FROM products p WHERE p.slug = ? AND ${published}`, c.params.slug);
    if (!p) return app.notFound(c);
    const files = db.all('SELECT original_name, size FROM product_files WHERE product_id = ?', p.id);
    const types = [...new Set(files.map((f) => (f.original_name.split('.').pop() || '').toUpperCase()))];
    const mb = files.reduce((n, f) => n + f.size, 0) / 1048576;
    const size = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(mb * 1024))} KB`;
    const related = db.all(`SELECT p2.* FROM products p2 WHERE p2.id != ? AND p2.category = ? AND ${published.replace(/p\./g, 'p2.')} ORDER BY p2.id DESC LIMIT 3`, p.id, p.category);
    const url = `${cfg.BASE_URL}/product/${p.slug}`;
    const off = p.compare_at_minor ? Math.round((1 - p.price_minor / p.compare_at_minor) * 100) : 0;
    const body = `
<section class="wrap section tight"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/shop">Shop</a> / <a href="/shop?category=${encodeURIComponent(p.category)}">${esc(p.category)}</a> / <span>${esc(p.title)}</span></nav>
<div class="pdp">
  <div class="pdp-media">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" width="800" height="500">` : `<div class="ph big" aria-hidden="true"><span>${esc(p.category.slice(0, 1))}</span></div>`}</div>
  <div class="pdp-info">
    <span class="eyebrow">${esc(p.category)}</span><h1>${esc(p.title)}</h1>
    <p class="lead muted">${esc(p.short_desc)}</p>
    <div class="pdp-price">${esc(money(p.price_minor, s.site.currency))}${p.compare_at_minor ? ` <s>${esc(money(p.compare_at_minor, s.site.currency))}</s> <span class="tag-off inline">Save ${off}%</span>` : ''}${s.tax.rate > 0 ? `<small>+ ${esc(s.tax.label)} ${s.tax.rate}% at checkout</small>` : ''}</div>
    <div class="cta"><button class="btn btn-primary btn-lg" type="button" data-add="${p.id}">Add to cart</button><button class="btn btn-amber btn-lg" type="button" data-buy="${p.id}">Buy now</button></div>
    <ul class="facts"><li>${UI.bolt} Instant download after payment is verified</li><li>${UI.file} ${files.length} file${files.length > 1 ? 's' : ''} &middot; ${esc(types.join(', '))} &middot; ${size}</li><li>${UI.lock} Secure checkout (card or bank transfer)</li><li>${UI.shield} Download protected to your account</li></ul>
    ${shareButtons(s, url, p.title)}
  </div></div>
  <div class="pdp-desc"><h2>About this product</h2>${richText(p.description) || `<p>${esc(p.short_desc)}</p>`}</div>
  ${related.length ? `<h2 class="mt">You may also like</h2><div class="grid">${related.map((r) => productCard(r, s.site.currency)).join('')}</div>` : ''}
</section>`;
    const jsonld = [
      { '@context': 'https://schema.org', '@type': 'Product', name: p.title, description: p.short_desc || p.title, category: p.category, ...(p.image && { image: abs(p.image) }), sku: `P${p.id}`, brand: { '@type': 'Brand', name: s.site.name },
        offers: { '@type': 'Offer', url, priceCurrency: s.site.currency, price: (p.price_minor / 100).toFixed(2), availability: 'https://schema.org/InStock' } },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [['Home', cfg.BASE_URL], ['Shop', `${cfg.BASE_URL}/shop`], [p.title, url]].map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) },
    ];
    page(c, { rawTitle: `${p.seo_title || p.title} | ${s.site.name}`, description: p.seo_desc || p.short_desc || s.site.description, path: `/product/${p.slug}`, page: 'product', image: p.image || null, ogType: 'product', jsonld, body });
  });

  // ---- cart / checkout / account (rendered by app.js) ------------------------------------------------------
  const shell = (title, pageName, inner, path, extra = {}) => (c) => page(c, { title, noindex: true, page: pageName, path, body: `<section class="wrap section tight"><div id="${pageName}-root" class="app-root"><p class="muted">Loading&hellip;</p></div>${inner || ''}</section>`, ...extra });
  app.route('GET', '/cart', shell('Your cart', 'cart', '<noscript><p>JavaScript is required to use the cart.</p></noscript>', '/cart'));
  app.route('GET', '/checkout', shell('Checkout', 'checkout', '', '/checkout'));
  app.route('GET', '/account', shell('My account', 'account', '', '/account'));
  app.route('GET', '/login', (c) => c.redirect('/account'));
  app.route('GET', '/reset', shell('Reset password', 'reset', '', '/reset'));

  app.route('GET', '/order/:number', (c) => {
    if (!c.user) return c.redirect(`/account?next=${encodeURIComponent(c.url.pathname)}`);
    const o = db.get('SELECT * FROM orders WHERE number = ?', c.params.number);
    if (!o || (o.user_id !== c.user.id && c.user.role !== 'admin')) return app.notFound(c);
    return page(c, { title: `Order ${o.number}`, noindex: true, page: 'order', path: `/order/${o.number}`, data: `data-number="${esc(o.number)}"`,
      body: '<section class="wrap section tight"><div id="order-root" class="app-root"><p class="muted">Loading your order&hellip;</p></div></section>' });
  });

  // ---- printable receipt / invoice ---------------------------------------------------------------------------------
  app.route('GET', '/receipt/:number', (c) => {
    if (!c.user) return c.redirect(`/account?next=${encodeURIComponent(c.url.pathname)}`);
    const o = db.get('SELECT * FROM orders WHERE number = ?', c.params.number);
    if (!o || (o.user_id !== c.user.id && c.user.role !== 'admin')) return app.notFound(c);
    const s = settings.get();
    const items = db.all('SELECT title, unit_minor FROM order_items WHERE order_id = ?', o.id);
    const pay = db.get("SELECT * FROM payments WHERE order_id = ? AND status = 'succeeded' ORDER BY id DESC LIMIT 1", o.id);
    const paid = o.status === 'paid';
    const label = { paid: 'PAID', refunded: 'REFUNDED', awaiting_transfer: 'AWAITING TRANSFER', pending: 'UNPAID', cancelled: 'CANCELLED', failed: 'FAILED' }[o.status] || o.status.toUpperCase();
    const fmt = (t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
    const body = `<section class="wrap narrow section"><article class="receipt">
  <div class="rc-head"><div><h1>${paid ? 'Payment receipt' : 'Invoice'}</h1><p class="muted">Order ${esc(o.number)}</p></div><span class="stamp ${paid ? 'ok' : 'warn'}">${label}</span></div>
  <div class="rc-cols"><div><h4>From</h4><p><strong>${esc(s.tax.legal_name || s.site.name)}</strong><br>${esc(s.tax.address || s.contact.address).replace(/\n/g, '<br>')}${s.tax.number ? `<br>Tax reg. no.: ${esc(s.tax.number)}` : ''}${s.contact.email ? `<br>${esc(s.contact.email)}` : ''}</p></div>
  <div><h4>Billed to</h4><p><strong>${esc(o.billing_name)}</strong><br>${esc(o.billing_email)}</p></div>
  <div><h4>Details</h4><p>Date: ${fmt(o.created_at)}<br>${paid && o.paid_at ? `Paid: ${fmt(o.paid_at)}<br>` : ''}Method: ${o.method === 'card' ? 'Card (Stripe)' : 'Bank transfer'}${pay && pay.provider_ref ? `<br>Ref: ${esc(pay.provider_ref.slice(-12))}` : ''}</p></div></div>
  <table class="rc-table"><thead><tr><th>Item</th><th class="r">Amount</th></tr></thead><tbody>${items.map((i) => `<tr><td>${esc(i.title)}</td><td class="r">${esc(money(i.unit_minor, o.currency))}</td></tr>`).join('')}</tbody>
  <tfoot><tr><td>Subtotal</td><td class="r">${esc(money(o.subtotal_minor, o.currency))}</td></tr>${o.tax_minor ? `<tr><td>${esc(s.tax.label)} (${o.tax_rate}%)</td><td class="r">${esc(money(o.tax_minor, o.currency))}</td></tr>` : ''}<tr class="tot"><td>Total${paid ? ' paid' : ' due'}</td><td class="r">${esc(money(o.total_minor, o.currency))}</td></tr></tfoot></table>
  ${!paid && o.status === 'awaiting_transfer' ? `<div class="notice"><strong>Bank transfer details</strong><br>Account holder: ${esc(s.bank.holder)}<br>${s.bank.bank_name ? `Bank: ${esc(s.bank.bank_name)}<br>` : ''}IBAN: ${esc(s.bank.iban)}${s.bank.swift ? `<br>SWIFT/BIC: ${esc(s.bank.swift)}` : ''}<br>Payment reference: <strong>${esc(o.number)}</strong></div>` : ''}
  <p class="muted small">Thank you for your purchase. Digital product licence terms apply (see Terms &amp; Conditions).</p>
  <div class="no-print"><button class="btn btn-primary" type="button" data-print>Print or save as PDF</button> <a class="btn btn-ghost" href="/order/${esc(o.number)}">Back to order</a></div></article></section>`;
    page(c, { title: `Receipt ${o.number}`, noindex: true, page: 'receipt', path: `/receipt/${o.number}`, body });
  });

  // ---- content pages ------------------------------------------------------------------------------------------------
  const simple = (path, key, title, desc) => app.route('GET', path, (c) => {
    const s = settings.get();
    page(c, { title, description: desc, path, page: key, body: `<section class="page-head"><div class="wrap"><nav class="crumbs"><a href="/">Home</a> / <span>${esc(title)}</span></nav><h1>${esc(title)}</h1></div></section><section class="wrap narrow section prose">${richText(s[key])}</section>` });
  });
  simple('/privacy', 'privacy', 'Privacy Policy', 'How we collect, use and protect your personal information.');
  simple('/terms', 'terms', 'Terms & Conditions', 'Terms of sale, licence and download conditions for digital products.');

  app.route('GET', '/about', (c) => {
    const s = settings.get();
    page(c, { title: s.about.title, description: s.site.description, path: '/about', page: 'about',
      body: `<section class="page-head"><div class="wrap"><nav class="crumbs"><a href="/">Home</a> / <span>About</span></nav><h1>${esc(s.about.title)}</h1></div></section><section class="wrap narrow section prose">${richText(s.about.body)}<p><a class="btn btn-primary" href="/shop">Browse the shop</a> <a class="btn btn-ghost" href="/contact">Get in touch</a></p><div class="socials dark">${socialLinks(s)}</div></section>` });
  });

  app.route('GET', '/faq', (c) => {
    const s = settings.get();
    page(c, { title: 'FAQ', description: 'Answers about payments, downloads, refunds and your account.', path: '/faq', page: 'faq',
      jsonld: [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: s.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }],
      body: `<section class="page-head"><div class="wrap"><nav class="crumbs"><a href="/">Home</a> / <span>FAQ</span></nav><h1>Frequently asked questions</h1></div></section><section class="wrap narrow section">${s.faq.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}<p class="mt">Still need help? <a href="/contact">Contact us</a>.</p></section>` });
  });

  app.route('GET', '/contact', (c) => {
    const s = settings.get();
    page(c, { title: 'Contact Us', description: `Contact ${s.site.name} for support, questions or custom work.`, path: '/contact', page: 'contact',
      body: `<section class="page-head"><div class="wrap"><nav class="crumbs"><a href="/">Home</a> / <span>Contact</span></nav><h1>Contact us</h1><p class="lead muted">Questions about a product, your order or a bank transfer? Send a message and we will reply as soon as we can.</p></div></section>
<section class="wrap section"><div class="split">
<form id="contact-form" class="form card-pad" novalidate>
  <label>Your name<input name="name" required maxlength="100" autocomplete="name"></label>
  <label>Email<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
  <label>Subject<input name="subject" maxlength="150"></label>
  <label>Message<textarea name="message" rows="6" required minlength="10" maxlength="5000"></textarea></label>
  <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button class="btn btn-primary" type="submit">Send message</button><p class="form-msg" role="alert"></p>
</form>
<div class="card-pad"><h3>Other ways to reach us</h3>${s.contact.email ? `<p>Email: <a href="mailto:${esc(s.contact.email)}">${esc(s.contact.email)}</a></p>` : ''}${s.contact.phone ? `<p>Phone: <a href="tel:${esc(s.contact.phone.replace(/[^+\d]/g, ''))}">${esc(s.contact.phone)}</a></p>` : ''}${s.contact.address ? `<p>${esc(s.contact.address).replace(/\n/g, '<br>')}</p>` : ''}${s.contact.hours ? `<p>${esc(s.contact.hours)}</p>` : ''}<h4>Follow</h4><div class="socials dark">${socialLinks(s)}</div></div></div></section>`,
      scripts: [] });
  });

  app.route('GET', '/payments', (c) => {
    const s = settings.get();
    const m = orders.availableMethods(app);
    const b = s.bank;
    page(c, { title: 'Payment methods', description: 'How to pay: secure card payments and bank transfer.', path: '/payments', page: 'payments',
      body: `<section class="page-head"><div class="wrap"><nav class="crumbs"><a href="/">Home</a> / <span>Payment methods</span></nav><h1>Payment methods</h1><p class="lead muted">Pay the way that suits you. Downloads unlock only after payment is verified.</p></div></section>
<section class="wrap section"><div class="grid two">
<div class="card-pad"><h3>${UI.lock} Card payment</h3><p>Pay by credit or debit card through Stripe's secure checkout. Your card details never touch this website. Payment is confirmed automatically and your download unlocks within seconds.</p><p class="muted small">${m.card ? 'Available at checkout.' : 'Currently unavailable.'} Works for customers in the UAE and internationally.</p></div>
<div class="card-pad"><h3>${UI.file} Bank transfer</h3><p>Choose bank transfer at checkout, then send the exact amount using your order number as the payment reference. We unlock your download once the funds are verified in our account (normally within one working day).</p>
${m.bank_transfer && b.show_public ? `<dl class="bank"><dt>Account holder</dt><dd>${esc(b.holder)}</dd>${b.bank_name ? `<dt>Bank</dt><dd>${esc(b.bank_name)}</dd>` : ''}<dt>IBAN</dt><dd>${esc(b.iban)}</dd>${b.account_no ? `<dt>Account no.</dt><dd>${esc(b.account_no)}</dd>` : ''}${b.swift ? `<dt>SWIFT / BIC</dt><dd>${esc(b.swift)}</dd>` : ''}${b.branch ? `<dt>Branch</dt><dd>${esc(b.branch)}</dd>` : ''}<dt>Currency</dt><dd>${esc(s.site.currency)}</dd></dl><p class="muted small">${esc(b.instructions)}</p>` : '<p class="muted small">Bank details are shown to you at checkout.</p>'}</div></div></section>` });
  });

  app.route('GET', '/tools', (c) => {
    page(c, { title: 'Free Planning Tools', description: 'Free earned value calculator: SPI, CPI, SV, CV, EAC, ETC, VAC and TCPI for project controls.', path: '/tools', page: 'tools',
      body: `<section class="page-head"><div class="wrap"><nav class="crumbs"><a href="/">Home</a> / <span>Free tools</span></nav><h1>Free planning tools</h1><p class="lead muted">Quick earned-value calculations for project controls. Enter your project values; results update as you type.</p></div></section>
<section class="wrap section"><div class="split"><form class="form card-pad" id="evm" onsubmit="return false"><h3>Earned value calculator</h3>
<label>Budget at completion (BAC)<input name="bac" type="number" min="0" step="any" inputmode="decimal" value="1000000"></label>
<label>Planned value (PV)<input name="pv" type="number" min="0" step="any" inputmode="decimal" value="400000"></label>
<label>Earned value (EV)<input name="ev" type="number" min="0" step="any" inputmode="decimal" value="360000"></label>
<label>Actual cost (AC)<input name="ac" type="number" min="0" step="any" inputmode="decimal" value="420000"></label></form>
<div class="card-pad"><h3>Results</h3><div class="results" id="evm-out" aria-live="polite"></div><p class="muted small">SPI = EV/PV &middot; CPI = EV/AC &middot; EAC = BAC/CPI &middot; ETC = EAC-AC &middot; VAC = BAC-EAC &middot; TCPI = (BAC-EV)/(BAC-AC)</p></div></div></section>`,
      scripts: ['/js/tools.js'] });
  });

  // ---- admin shell ---------------------------------------------------------------------------------------------------------
  app.route('GET', '/admin', (c) => {
    c.res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Admin | ${esc(settings.get().site.name)}</title>
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml"><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/admin.css"></head><body class="admin"><div id="admin-root"><p class="muted pad">Loading&hellip;</p></div><div class="toast" id="toast" role="status" aria-live="polite"></div><script src="/js/admin.js" defer></script></body></html>`);
  });

  // ---- SEO + analytics -----------------------------------------------------------------------------------------------------------
  app.route('GET', '/robots.txt', (c) => c.send(200, { 'Content-Type': 'text/plain; charset=utf-8' },
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /account\nDisallow: /checkout\nDisallow: /cart\nDisallow: /order/\nDisallow: /receipt/\nDisallow: /download/\nSitemap: ${cfg.BASE_URL}/sitemap.xml\n`));

  app.route('GET', '/sitemap.xml', (c) => {
    const urls = ['/', '/shop', '/about', '/faq', '/contact', '/payments', '/tools', '/privacy', '/terms']
      .map((p) => ({ loc: cfg.BASE_URL + p }))
      .concat(db.all(`SELECT p.slug, p.updated_at FROM products p WHERE ${published}`).map((p) => ({ loc: `${cfg.BASE_URL}/product/${p.slug}`, mod: new Date(p.updated_at).toISOString().slice(0, 10) })));
    c.send(200, { 'Content-Type': 'application/xml; charset=utf-8' },
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(u.loc)}</loc>${u.mod ? `<lastmod>${u.mod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`);
  });

  app.route('GET', '/js/analytics.js', (c) => {
    const id = settings.get().analytics.ga_id;
    const js = id ? `(function(){var id=${JSON.stringify(id)};var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(id);document.head.appendChild(s);window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());gtag('config',id,{anonymize_ip:true});})();` : '';
    c.send(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' }, js);
  });
};
