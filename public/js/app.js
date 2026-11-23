'use strict';
/* Storefront behaviour. The browser never decides whether something is paid: it only asks the server for the status. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const page = document.body.dataset.page;
  let me = { user: null, csrf: '', currency: 'AED', tax: { rate: 0, label: 'VAT' }, methods: {} };

  const fmt = (minor) => { try { return new Intl.NumberFormat('en-AE', { style: 'currency', currency: me.currency, currencyDisplay: 'code' }).format(minor / 100).replace(/ /g, ' '); } catch { return `${me.currency} ${(minor / 100).toFixed(2)}`; } };
  const fmtDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const STATUS = { paid: 'Paid', pending: 'Awaiting payment', awaiting_transfer: 'Awaiting bank transfer', failed: 'Failed', cancelled: 'Cancelled', refunded: 'Refunded' };

  function toast(msg, kind = '') {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.className = `toast show ${kind}`;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.className = 'toast'; }, 3200);
  }

  async function api(path, opts = {}, retry = true) {
    const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (init.method !== 'GET') init.headers['X-CSRF-Token'] = me.csrf;
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && retry && /security token/i.test(data.error || '')) { await loadMe(); return api(path, opts, false); }
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; throw e; }
    return data;
  }
  async function loadMe() { me = await api('/api/me'); return me; }

  // ---- cart (product ids only; prices always come from the server) ------------------------------------
  const cart = {
    get() { try { return [...new Set(JSON.parse(localStorage.getItem('cart') || '[]').map(Number).filter(Number.isInteger))]; } catch { return []; } },
    set(a) { try { localStorage.setItem('cart', JSON.stringify(a)); } catch { /* storage blocked */ } cart.badge(); },
    add(id) { const a = cart.get(); if (!a.includes(id)) a.push(id); cart.set(a); },
    remove(id) { cart.set(cart.get().filter((x) => x !== id)); },
    clear() { cart.set([]); },
    badge() { const n = cart.get().length; $$('[data-cart-count]').forEach((b) => { b.textContent = n; b.hidden = !n; }); },
  };
  window.__cart = cart;

  async function loadCartProducts() {
    const ids = cart.get();
    if (!ids.length) return [];
    const { products } = await api(`/api/products?ids=${ids.join(',')}`);
    const live = products.map((p) => p.id);
    if (live.length !== ids.length) cart.set(ids.filter((i) => live.includes(i)));
    return products;
  }
  const totals = (products) => {
    const sub = products.reduce((n, p) => n + p.price_minor, 0);
    const tax = Math.round((sub * (me.tax.rate || 0)) / 100);
    return { sub, tax, total: sub + tax };
  };
  const thumb = (p) => (p.image ? `<img src="${esc(p.image)}" alt="" width="84" height="56">` : `<div class="ph"><span>${esc(p.category.slice(0, 1))}</span></div>`);
  const safeNext = () => { const n = new URLSearchParams(location.search).get('next') || ''; return /^\/(?!\/)[\w\-./?=&%]*$/.test(n) ? n : ''; };

  // ---- global handlers -----------------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-add],[data-buy],[data-copy],[data-print],[data-cookie],.menu-btn');
    if (!t) return;
    if (t.dataset.add) { cart.add(+t.dataset.add); toast('Added to cart', 'ok'); }
    else if (t.dataset.buy) { cart.add(+t.dataset.buy); location.href = '/checkout'; }
    else if (t.dataset.copy) { navigator.clipboard?.writeText(t.dataset.copy).then(() => toast('Link copied', 'ok'), () => toast('Could not copy', 'err')); }
    else if ('print' in t.dataset) window.print();
    else if (t.dataset.cookie) { localStorage.setItem('consent', t.dataset.cookie); $('#cookie').hidden = true; if (t.dataset.cookie === 'yes') loadAnalytics(); }
    else if (t.classList.contains('menu-btn')) { const open = $('#nav').classList.toggle('open'); t.setAttribute('aria-expanded', open); }
  });
  function loadAnalytics() { const s = document.createElement('script'); s.src = '/js/analytics.js'; document.head.appendChild(s); }
  (function consent() {
    const box = $('#cookie'); if (!box) return;
    const v = localStorage.getItem('consent');
    if (v === 'yes') loadAnalytics(); else if (!v) box.hidden = false;
  })();

  // ---- auth UI ---------------------------------------------------------------------------------------------------
  function authBox(root, onDone) {
    root.innerHTML = `<div class="auth-box card-pad">
      <div class="tabs" role="tablist"><button class="on" data-tab="in" role="tab">Sign in</button><button data-tab="up" role="tab">Create account</button></div>
      <form id="f-in" class="form" novalidate><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn btn-primary" type="submit">Sign in</button><p class="form-msg err" role="alert"></p><p class="small"><a href="#" id="forgot">Forgot your password?</a></p></form>
      <form id="f-up" class="form" hidden novalidate><label>Full name<input name="name" autocomplete="name" required></label><label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password (8+ characters)<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <button class="btn btn-primary" type="submit">Create account</button><p class="form-msg err" role="alert"></p>
        <p class="small muted">By creating an account you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p></form>
      <form id="f-forgot" class="form" hidden novalidate><label>Your account email<input name="email" type="email" required></label><button class="btn btn-primary" type="submit">Send reset link</button><p class="form-msg" role="alert"></p><p class="small"><a href="#" id="back">Back to sign in</a></p></form></div>`;
    const show = (id) => ['f-in', 'f-up', 'f-forgot'].forEach((f) => { $(`#${f}`, root).hidden = f !== id; });
    $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => { $$('[data-tab]', root).forEach((x) => x.classList.toggle('on', x === b)); show(b.dataset.tab === 'in' ? 'f-in' : 'f-up'); }));
    $('#forgot', root).addEventListener('click', (e) => { e.preventDefault(); show('f-forgot'); });
    $('#back', root).addEventListener('click', (e) => { e.preventDefault(); show('f-in'); });
    const submit = (formId, path, after) => $(`#${formId}`, root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target; const msg = $('.form-msg', f); const btn = $('button[type=submit]', f);
      msg.textContent = ''; btn.disabled = true;
      try { const r = await api(path, { method: 'POST', body: Object.fromEntries(new FormData(f)) }); await after(r, msg); }
      catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
      btn.disabled = false;
    });
    const done = async () => { await loadMe(); onDone(); };
    submit('f-in', '/api/auth/login', done);
    submit('f-up', '/api/auth/register', done);
    submit('f-forgot', '/api/auth/forgot', (r, msg) => { msg.className = 'form-msg ok'; msg.textContent = r.emailEnabled ? 'If that email has an account, a reset link is on its way.' : 'Password reset by email is not set up yet. Please contact us and we will help.'; });
  }

  // ---- cart page ---------------------------------------------------------------------------------------------------
  async function renderCart() {
    const root = $('#cart-root');
    const products = await loadCartProducts();
    if (!products.length) { root.innerHTML = '<div class="empty"><h2>Your cart is empty</h2><p class="muted">Browse the shop to find templates, courses and guides.</p><a class="btn btn-primary" href="/shop">Go to the shop</a></div>'; return; }
    const t = totals(products);
    root.innerHTML = `<h1>Your cart</h1><div class="layout-2"><div>${products.map((p) => `<div class="cart-item">${thumb(p)}<div><h3><a href="/product/${esc(p.slug)}">${esc(p.title)}</a></h3><span class="muted small">${esc(p.category)} &middot; digital download</span></div><div><strong>${fmt(p.price_minor)}</strong><br><button class="link-btn" data-rm="${p.id}">Remove</button></div></div>`).join('')}</div>
      <aside class="summary"><h3>Order summary</h3><dl><dt>Subtotal</dt><dd>${fmt(t.sub)}</dd>${t.tax ? `<dt>${esc(me.tax.label)} (${me.tax.rate}%)</dt><dd>${fmt(t.tax)}</dd>` : ''}</dl><div class="total" style="display:flex;justify-content:space-between"><span>Total</span><span>${fmt(t.total)}</span></div>
      <p><a class="btn btn-amber btn-lg" style="width:100%;margin-top:14px" href="/checkout">Checkout securely</a></p><p class="muted small">Your download unlocks automatically after payment is verified.</p></aside></div>`;
    $$('[data-rm]', root).forEach((b) => b.addEventListener('click', () => { cart.remove(+b.dataset.rm); renderCart(); }));
  }

  // ---- checkout page --------------------------------------------------------------------------------------------------
  async function renderCheckout() {
    const root = $('#checkout-root');
    if (!me.user) { root.innerHTML = '<h1>Checkout</h1><p class="lead muted">Sign in or create an account so we can attach your purchase and downloads to it.</p><div id="auth-slot"></div>'; authBox($('#auth-slot'), renderCheckout); return; }
    const products = await loadCartProducts();
    if (!products.length) { root.innerHTML = '<div class="empty"><h2>Your cart is empty</h2><a class="btn btn-primary" href="/shop">Go to the shop</a></div>'; return; }
    const t = totals(products); const m = me.methods;
    const none = !m.card && !m.bank_transfer;
    root.innerHTML = `<h1>Secure checkout</h1><div class="layout-2"><div>
      <div class="card-pad"><h3>1. Your details</h3><p>${esc(me.user.name)}<br><span class="muted">${esc(me.user.email)}</span></p></div>
      <div class="card-pad" style="margin-top:16px"><h3>2. Payment method</h3><div id="err"></div>
        ${none ? '<div class="alert warn">Payments are not available right now. Please <a href="/contact">contact us</a> to complete your order.</div>' : ''}
        ${m.card ? `<label class="pay-opt"><input type="radio" name="method" value="card" checked><span><strong>Pay by card</strong><span class="muted small">Visa, Mastercard and more via Stripe's secure page. Download unlocks automatically once the payment is verified.</span></span></label>` : ''}
        ${m.bank_transfer ? `<label class="pay-opt"><input type="radio" name="method" value="bank_transfer" ${m.card ? '' : 'checked'}><span><strong>Bank transfer</strong><span class="muted small">You will get our bank details and a payment reference. Download unlocks after we verify the funds.</span></span></label>` : ''}
      </div></div>
      <aside class="summary"><h3>Order summary</h3>${products.map((p) => `<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:8px"><span>${esc(p.title)}</span><strong>${fmt(p.price_minor)}</strong></div>`).join('')}
      <hr style="border:0;border-top:1px solid var(--line)"><dl><dt>Subtotal</dt><dd>${fmt(t.sub)}</dd>${t.tax ? `<dt>${esc(me.tax.label)} (${me.tax.rate}%)</dt><dd>${fmt(t.tax)}</dd>` : ''}</dl>
      <div class="total" style="display:flex;justify-content:space-between"><span>Total</span><span>${fmt(t.total)}</span></div>
      <button id="pay" class="btn btn-amber btn-lg" style="width:100%;margin-top:14px" ${none ? 'disabled' : ''}>Place order</button>
      <p class="muted small">By placing your order you agree to the <a href="/terms">Terms &amp; Conditions</a>. Totals are recalculated on our server from current prices.</p></aside></div>`;
    $('#pay', root).addEventListener('click', async (ev) => {
      const btn = ev.currentTarget; const method = ($('input[name=method]:checked', root) || {}).value;
      btn.disabled = true; btn.textContent = 'Please wait…'; $('#err', root).innerHTML = '';
      try {
        const r = await api('/api/checkout', { method: 'POST', body: { items: products.map((p) => p.id), method } });
        cart.clear();
        location.href = r.url || `/order/${r.order}`;
      } catch (err) {
        $('#err', root).innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
        btn.disabled = false; btn.textContent = 'Place order';
      }
    });
  }

  // ---- account page ------------------------------------------------------------------------------------------------------------
  async function renderAccount() {
    const root = $('#account-root');
    if (!me.user) { root.innerHTML = '<h1>My account</h1>'; const slot = document.createElement('div'); root.appendChild(slot); authBox(slot, () => { const n = safeNext(); if (n) location.href = n; else renderAccount(); }); return; }
    const { orders } = await api('/api/orders');
    root.innerHTML = `<div class="sec-head"><div><h1 style="margin:0">Hello, ${esc(me.user.name.split(' ')[0])}</h1><span class="muted">${esc(me.user.email)}</span></div><div>${me.user.role === 'admin' ? '<a class="btn btn-ghost btn-sm" href="/admin">Admin dashboard</a> ' : ''}<button class="btn btn-ghost btn-sm" id="logout">Sign out</button></div></div>
      <div class="tabs"><button class="on" data-t="orders">Orders &amp; downloads</button><button data-t="profile">Password</button></div>
      <div id="tab-orders">${orders.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${orders.map((o) => `<tr><td><strong>${esc(o.number)}</strong></td><td>${fmtDate(o.created_at)}</td><td>${o.items.map((i) => esc(i.title)).join(', ')}</td><td>${fmt(o.total_minor)}</td><td><span class="status ${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span></td><td><a class="btn btn-sm ${o.status === 'paid' ? 'btn-primary' : 'btn-ghost'}" href="/order/${esc(o.number)}">${o.status === 'paid' ? 'Downloads' : 'View'}</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>No orders yet</h3><a class="btn btn-primary" href="/shop">Browse the shop</a></div>'}</div>
      <div id="tab-profile" hidden class="card-pad" style="max-width:460px"><h3>Change password</h3><form id="f-pw" class="form"><label>Current password<input type="password" name="current" autocomplete="current-password" required></label><label>New password<input type="password" name="password" autocomplete="new-password" minlength="8" required></label><button class="btn btn-primary">Update password</button><p class="form-msg" role="alert"></p></form></div>`;
    $('#logout', root).addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); await loadMe(); renderAccount(); });
    $$('[data-t]', root).forEach((b) => b.addEventListener('click', () => { $$('[data-t]', root).forEach((x) => x.classList.toggle('on', x === b)); $('#tab-orders', root).hidden = b.dataset.t !== 'orders'; $('#tab-profile', root).hidden = b.dataset.t !== 'profile'; }));
    $('#f-pw', root).addEventListener('submit', async (e) => {
      e.preventDefault(); const msg = $('.form-msg', e.target);
      try { const r = await api('/api/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); me.csrf = r.csrf; msg.className = 'form-msg ok'; msg.textContent = 'Password updated.'; e.target.reset(); }
      catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
    });
  }

  // ---- order page (status always comes from the server) --------------------------------------------------------------------------------
  async function renderOrder() {
    const root = $('#order-root'); const number = document.body.dataset.number;
    const qp = new URLSearchParams(location.search);
    let order;
    const load = async (refresh) => { order = (await api(`/api/orders/${encodeURIComponent(number)}${refresh ? '/refresh' : ''}`, refresh ? { method: 'POST' } : {})).order; };
    try {
      await load(false);
      // A pending card order is checked against Stripe server-to-server, so a late webhook never leaves the customer waiting.
      if (order.status === 'pending' && order.method === 'card') await load(true).catch(() => {});
    } catch (e) { root.innerHTML = `<div class="alert err">${esc(e.message)}</div><a class="btn btn-primary" href="/account">My account</a>`; return; }
    draw();
    if (order.status === 'pending' && order.method === 'card' && qp.get('return') === '1') {
      let tries = 0;
      const poll = setInterval(async () => {
        tries += 1;
        try { await load(true); } catch { /* keep trying */ }
        if (order.status !== 'pending' || tries >= 12) { clearInterval(poll); draw(); }
      }, 3000);
    }
    function draw() {
      const paid = order.status === 'paid';
      let banner = '';
      if (paid) banner = '<div class="alert ok"><strong>Payment verified.</strong> Thank you! Your downloads are unlocked below.</div>';
      else if (order.status === 'pending' && order.method === 'card') banner = qp.get('cancelled') ? '<div class="alert warn">The payment was not completed. You can try again below.</div>' : '<div class="alert info"><strong>Confirming your payment with the payment provider…</strong> This page updates automatically. Your download stays locked until payment is verified.</div>';
      else if (order.status === 'awaiting_transfer') banner = '<div class="alert info"><strong>Waiting for your bank transfer.</strong> Downloads unlock after we verify the funds in our account.</div>';
      else if (order.status === 'refunded') banner = '<div class="alert warn">This order was refunded and downloads are disabled.</div>';
      else banner = `<div class="alert err">This order is ${esc(STATUS[order.status] || order.status).toLowerCase()}.</div>`;
      const bank = order.bank ? `<div class="order-box"><h3>Bank transfer details</h3><dl class="bank"><dt>Amount</dt><dd>${fmt(order.total_minor)}</dd><dt>Account holder</dt><dd>${esc(order.bank.holder)}</dd>${order.bank.bank_name ? `<dt>Bank</dt><dd>${esc(order.bank.bank_name)}</dd>` : ''}<dt>IBAN</dt><dd>${esc(order.bank.iban)}</dd>${order.bank.account_no ? `<dt>Account no.</dt><dd>${esc(order.bank.account_no)}</dd>` : ''}${order.bank.swift ? `<dt>SWIFT / BIC</dt><dd>${esc(order.bank.swift)}</dd>` : ''}${order.bank.branch ? `<dt>Branch</dt><dd>${esc(order.bank.branch)}</dd>` : ''}<dt>Payment reference</dt><dd>${esc(order.number)}</dd></dl><p class="muted small">${esc(order.bank.instructions)}</p><button class="btn btn-ghost btn-sm" data-copy="${esc(order.number)}">Copy reference</button></div>` : '';
      const reason = { limit: 'Download limit reached. Contact us to reset it.', revoked: 'Access disabled. Contact us.', expired: 'Download expired. Contact us.', locked: 'Locked until payment is verified.' };
      const items = order.items.map((it) => `<div class="order-box"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h3 style="margin:0">${esc(it.title)}</h3><strong>${fmt(it.unit_minor)}</strong></div>
        ${it.locked ? '<p class="locked">🔒 <span>Download locked until payment is verified</span></p><button class="btn btn-primary btn-sm" disabled>Download</button>'
        : it.files.map((f) => `<div class="file-row"><div><strong>${esc(f.name)}</strong><br><span class="muted small">${fmtSize(f.size)} &middot; ${f.downloads_left} download${f.downloads_left === 1 ? '' : 's'} left</span></div>${f.available ? `<a class="btn btn-primary btn-sm" href="${esc(f.url)}">Download</a>` : `<span class="muted small">${esc(reason[f.reason] || 'Unavailable')}</span>`}</div>`).join('')}</div>`).join('');
      root.innerHTML = `<div class="sec-head"><div><span class="eyebrow">Order</span><h1 style="margin:0">${esc(order.number)}</h1><span class="muted">${fmtDate(order.created_at)} &middot; <span class="status ${esc(order.status)}">${esc(STATUS[order.status] || order.status)}</span></span></div><div><a class="btn btn-ghost btn-sm" href="/receipt/${esc(order.number)}" target="_blank" rel="noopener">${paid ? 'View receipt' : 'View invoice'}</a> <a class="btn btn-ghost btn-sm" href="/account">All orders</a></div></div>
        ${banner}${bank}${order.status === 'pending' && order.method === 'card' ? '<p><button class="btn btn-amber" id="retry">Pay now by card</button></p>' : ''}${items}
        <div class="order-box"><dl style="display:grid;grid-template-columns:1fr auto;gap:6px;margin:0"><dt>Subtotal</dt><dd style="margin:0;text-align:right">${fmt(order.subtotal_minor)}</dd>${order.tax_minor ? `<dt>${esc(me.tax.label)} (${order.tax_rate}%)</dt><dd style="margin:0;text-align:right">${fmt(order.tax_minor)}</dd>` : ''}<dt><strong>Total</strong></dt><dd style="margin:0;text-align:right"><strong>${fmt(order.total_minor)}</strong></dd></dl></div>`;
      const retry = $('#retry', root);
      if (retry) retry.addEventListener('click', async () => { retry.disabled = true; try { const r = await api(`/api/orders/${encodeURIComponent(number)}/pay`, { method: 'POST' }); location.href = r.url; } catch (e) { toast(e.message, 'err'); retry.disabled = false; } });
    }
  }

  // ---- reset password / contact -----------------------------------------------------------------------------------------------------------
  function renderReset() {
    const root = $('#reset-root'); const token = new URLSearchParams(location.search).get('token') || '';
    root.innerHTML = `<div class="auth-box card-pad"><h2>Choose a new password</h2><form class="form"><label>New password (8+ characters)<input type="password" name="password" minlength="8" autocomplete="new-password" required></label><button class="btn btn-primary">Save password</button><p class="form-msg" role="alert"></p></form></div>`;
    $('form', root).addEventListener('submit', async (e) => {
      e.preventDefault(); const msg = $('.form-msg', e.target);
      try { await api('/api/auth/reset', { method: 'POST', body: { token, password: e.target.password.value } }); msg.className = 'form-msg ok'; msg.innerHTML = 'Password updated. <a href="/account">Sign in</a>'; }
      catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
    });
  }
  function wireContact() {
    const f = $('#contact-form'); if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const msg = $('.form-msg', f); const btn = $('button[type=submit]', f);
      btn.disabled = true; msg.textContent = '';
      try { await api('/api/contact', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); f.reset(); msg.className = 'form-msg ok'; msg.textContent = 'Thank you! Your message has been sent.'; }
      catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
      btn.disabled = false;
    });
  }

  (async () => {
    cart.badge();
    try { await loadMe(); } catch { /* offline */ }
    const link = $('[data-account-link]'); if (link && me.user) link.title = `Signed in as ${me.user.name}`;
    wireContact();
    const run = { cart: renderCart, checkout: renderCheckout, account: renderAccount, order: renderOrder, reset: renderReset }[page];
    if (run) { try { await run(); } catch (e) { const r = $('.app-root'); if (r) r.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; } }
  })();
})();
