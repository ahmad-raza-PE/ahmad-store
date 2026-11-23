'use strict';
const cfg = require('./config');
const { SOCIAL_LABELS } = require('./settings');
const { esc, money, richText } = require('./util');

// Simple custom-drawn brand glyphs (24x24, currentColor). Swap for official artwork if you prefer.
const ICONS = {
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2"/>',
  facebook: '<path d="M14 8h2.5V5H14c-2.2 0-4 1.8-4 4v2H8v3h2v6h3v-6h2.5l.5-3h-3V9c0-.6.4-1 1-1z"/>',
  tiktok: '<path d="M16.5 3c.3 2.2 1.7 3.9 4 4.1v3.2c-1.5 0-2.9-.5-4-1.3v6.2a5.6 5.6 0 1 1-5.6-5.6c.3 0 .6 0 .9.1v3.3a2.4 2.4 0 1 0 1.6 2.2V3h3.1z"/>',
  youtube: '<path fill-rule="evenodd" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3L10 15z"/>',
  whatsapp: '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8c-1-.4-2-1.4-2.4-2.4l.8-1-1-2L9 8.5z"/>',
  x: '<path d="M18.2 3h3l-6.6 7.6L22 21h-6l-4.7-6.1L5.8 21h-3l7-8.1L2 3h6.2l4.2 5.6L18.2 3zm-1 16.2h1.7L7 4.7H5.2l12 14.5z"/>',
  linkedin: '<path fill-rule="evenodd" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7.3 9.5v8h2.4v-8H7.3zM8.5 6.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM11 9.5v8h2.4v-4.2c0-1.1.5-1.8 1.4-1.8s1.2.7 1.2 1.7v4.3h2.4v-4.8c0-2.2-1.2-3.3-2.9-3.3-1.1 0-1.8.5-2.1 1.1v-.9H11z"/>',
  telegram: '<path fill-rule="evenodd" d="M21.5 3.5L2.8 10.7c-.8.3-.8 1.3 0 1.6l4.6 1.5 1.8 5.6c.2.6.9.7 1.3.3l2.6-2.4 4.7 3.5c.6.4 1.4.1 1.6-.6l3-15.2c.2-.8-.6-1.4-1.4-1zM9.3 13.3l8.6-5.4-6.9 6.5-.3 3.2-1.4-4.3z"/>',
  snapchat: '<path d="M12 3c-2.8 0-4.6 2-4.6 4.6v2.2c-.6.1-1.2.1-1.6.3-.5.2-.4.8.1 1 .5.2 1.2.4 1.2.8 0 .5-1.2 2.4-3.2 2.8-.4.1-.5.6-.1.9.7.5 1.6.6 2.1.7.2.3.1 1 .6 1.1.7.1 1.6-.2 2.4.1 1 .4 1.5 1.5 3.1 1.5s2.1-1.1 3.1-1.5c.8-.3 1.7 0 2.4-.1.5-.1.4-.8.6-1.1.5-.1 1.4-.2 2.1-.7.4-.3.3-.8-.1-.9-2-.4-3.2-2.3-3.2-2.8 0-.4.7-.6 1.2-.8.5-.2.6-.8.1-1-.4-.2-1-.2-1.6-.3V7.6C16.6 5 14.8 3 12 3z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};
const icon = (name, size = 20) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const UI = {
  cart: '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1.5 1.5 0 0 0 1.5 1.1h8.6a1.5 1.5 0 0 0 1.5-1.1L21 7H6"/></svg>',
  user: '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  search: '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  menu: '<svg class="ico" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  lock: '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  bolt: '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  shield: '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  file: '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
};

function socialLinks(s, cls = 'soc') {
  return Object.entries(s.social)
    .filter(([, v]) => v.enabled && v.url)
    .map(([k, v]) => `<a class="${cls}" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer me" aria-label="${esc(SOCIAL_LABELS[k] || k)}" title="${esc(SOCIAL_LABELS[k] || k)}">${icon(k, 20)}</a>`)
    .join('');
}

function shareButtons(s, url, title) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  return `<div class="share" aria-label="Share this product"><span>Share</span>
    <a class="soc" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${t}%20${u}" aria-label="Share on WhatsApp">${icon('whatsapp')}</a>
    <a class="soc" target="_blank" rel="noopener noreferrer" href="https://www.facebook.com/sharer/sharer.php?u=${u}" aria-label="Share on Facebook">${icon('facebook')}</a>
    <a class="soc" target="_blank" rel="noopener noreferrer" href="https://twitter.com/intent/tweet?url=${u}&text=${t}" aria-label="Share on X">${icon('x')}</a>
    <a class="soc" target="_blank" rel="noopener noreferrer" href="https://www.linkedin.com/sharing/share-offsite/?url=${u}" aria-label="Share on LinkedIn">${icon('linkedin')}</a>
    <a class="soc" target="_blank" rel="noopener noreferrer" href="https://t.me/share/url?url=${u}&text=${t}" aria-label="Share on Telegram">${icon('telegram')}</a>
    <button class="soc" type="button" data-copy="${esc(url)}" aria-label="Copy link">${icon('link')}</button></div>`;
}

const abs = (p) => (/^https?:\/\//.test(p) ? p : cfg.BASE_URL + p);

function layout(app, o) {
  const s = app.settings.get();
  const title = o.rawTitle || (o.title ? `${o.title} | ${s.site.name}` : `${s.site.name} | ${s.site.tagline}`);
  const desc = o.description || s.site.description;
  const canonical = abs(o.path || '/');
  const navHtml = s.nav.map((n) => `<a href="${esc(n.href)}"${o.path === n.href ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`).join('');
  const cats = s.categories.map((c) => `<a href="/shop?category=${encodeURIComponent(c)}">${esc(c)}</a>`).join('');
  const wa = s.social.whatsapp;
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc.slice(0, 200))}">
<link rel="canonical" href="${esc(canonical)}">
${o.noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
<meta property="og:type" content="${o.ogType || 'website'}"><meta property="og:site_name" content="${esc(s.site.name)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc.slice(0, 200))}">
<meta property="og:url" content="${esc(canonical)}">${o.image ? `<meta property="og:image" content="${esc(abs(o.image))}">` : ''}
<meta name="twitter:card" content="${o.image ? 'summary_large_image' : 'summary'}">
<meta name="theme-color" content="#0a1a33">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/app.css">
${(o.jsonld || []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body data-page="${esc(o.page || '')}"${o.data ? ' ' + o.data : ''}>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header"><div class="wrap bar">
  <a class="brand" href="/" aria-label="${esc(s.site.name)} home"><span class="mark">${esc(s.site.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</span><span class="brand-name">${esc(s.site.name)}</span></a>
  <nav class="nav" id="nav" aria-label="Main">${navHtml}</nav>
  <div class="actions">
    <a class="iconbtn" href="/shop" aria-label="Search the shop">${UI.search}</a>
    <a class="iconbtn" href="/account" aria-label="My account" data-account-link>${UI.user}</a>
    <a class="iconbtn cart-link" href="/cart" aria-label="Shopping cart">${UI.cart}<span class="badge" data-cart-count hidden>0</span></a>
    <a class="btn btn-amber btn-sm hide-sm" href="/shop">Shop now</a>
    <button class="iconbtn menu-btn" type="button" aria-label="Menu" aria-controls="nav" aria-expanded="false">${UI.menu}</button>
  </div></div></header>
<main id="main">
${o.body}
</main>
<footer class="site-footer"><div class="wrap">
  <div class="foot-grid">
    <div><a class="brand light" href="/"><span class="mark">${esc(s.site.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</span><span class="brand-name">${esc(s.site.name)}</span></a>
      <p class="muted-l">${esc(s.footer.text)}</p>
      <div class="socials">${socialLinks(s)}</div></div>
    <div><h4>Shop</h4>${cats}<a href="/shop">All products</a><a href="/tools">Free tools</a></div>
    <div><h4>Help</h4><a href="/faq">FAQ</a><a href="/payments">Payment methods</a><a href="/contact">Contact us</a><a href="/account">My account</a></div>
    <div><h4>Company</h4><a href="/about">About</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms &amp; Conditions</a>
      ${s.contact.email ? `<a href="mailto:${esc(s.contact.email)}">${esc(s.contact.email)}</a>` : ''}${s.contact.phone ? `<a href="tel:${esc(s.contact.phone.replace(/[^+\d]/g, ''))}">${esc(s.contact.phone)}</a>` : ''}</div>
  </div>
  <div class="foot-pay"><span>${UI.lock} Secure card payments by Stripe</span><span>Bank transfer accepted</span><span>${UI.bolt} Instant download after verification</span></div>
  <div class="foot-base"><span>&copy; ${year} ${esc(s.tax.legal_name || s.site.name)}. All rights reserved.${s.tax.number ? ` Tax registration no. ${esc(s.tax.number)}.` : ''}</span><span>Prices in ${esc(s.site.currency)}</span></div>
</div></footer>
${wa.enabled && wa.url ? `<a class="wa-fab" href="${esc(wa.url)}" target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp">${icon('whatsapp', 28)}</a>` : ''}
${s.analytics.ga_id ? '<div class="cookie" id="cookie" hidden><p>We use analytics cookies to improve this site. You can accept or decline.</p><div><button class="btn btn-sm btn-amber" data-cookie="yes">Accept</button> <button class="btn btn-sm btn-ghost" data-cookie="no">Decline</button></div></div>' : ''}
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script src="/js/app.js" defer></script>
${(o.scripts || []).map((src) => `<script src="${esc(src)}" defer></script>`).join('\n')}
</body></html>`;
}

function productCard(p, currency) {
  const off = p.compare_at_minor ? Math.round((1 - p.price_minor / p.compare_at_minor) * 100) : 0;
  const img = p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" width="640" height="400">`
    : `<div class="ph" aria-hidden="true"><span>${esc(p.category.slice(0, 1))}</span></div>`;
  return `<article class="card product">
  <a class="thumb" href="/product/${esc(p.slug)}" aria-label="${esc(p.title)}">${img}${off ? `<span class="tag-off">-${off}%</span>` : ''}</a>
  <div class="card-body">
    <span class="eyebrow">${esc(p.category)}</span>
    <h3><a href="/product/${esc(p.slug)}">${esc(p.title)}</a></h3>
    <p class="muted">${esc(p.short_desc)}</p>
    <div class="price-row"><div class="price">${esc(money(p.price_minor, currency))}${p.compare_at_minor ? ` <s>${esc(money(p.compare_at_minor, currency))}</s>` : ''}</div>
    <button class="btn btn-sm btn-primary" type="button" data-add="${p.id}">Add to cart</button></div>
  </div></article>`;
}

module.exports = { layout, productCard, socialLinks, shareButtons, icon, UI, abs, richText };
