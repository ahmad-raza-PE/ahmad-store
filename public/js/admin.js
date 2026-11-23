'use strict';
/* Admin dashboard (vanilla JS). Every action is enforced again on the server: this UI is convenience, not security. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const root = $('#admin-root');
  let me = { user: null, csrf: '' };
  let S = null;      // settings
  let SERVER = null; // server info
  let currency = 'AED';

  const money = (m, c = currency) => { try { return new Intl.NumberFormat('en-AE', { style: 'currency', currency: c, currencyDisplay: 'code' }).format(m / 100).replace(/ /g, ' '); } catch { return `${c} ${(m / 100).toFixed(2)}`; } };
  const dt = (t) => (t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const STATUS = { paid: 'Paid', pending: 'Pending (card)', awaiting_transfer: 'Awaiting transfer', failed: 'Failed', cancelled: 'Cancelled', refunded: 'Refunded' };
  const pill = (s) => `<span class="status ${esc(s)}">${esc(STATUS[s] || s)}</span>`;

  function toast(msg, kind = '') {
    const t = $('#toast'); t.textContent = msg; t.className = `toast show ${kind}`;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.className = 'toast'; }, 3500);
  }
  async function api(path, opts = {}, retry = true) {
    const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (init.method !== 'GET') init.headers['X-CSRF-Token'] = me.csrf;
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && retry && /security token/i.test(data.error || '')) { me = await api('/api/me'); return api(path, opts, false); }
    if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.status = res.status; throw e; }
    return data;
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 'err'); } };

  function modal(html) {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="btn btn-ghost btn-sm x" type="button">Close</button>${html}</div>`;
    const close = () => bg.remove();
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.classList.contains('x')) close(); });
    document.body.appendChild(bg);
    return { el: $('.modal', bg), close };
  }

  // ---- sign in ---------------------------------------------------------------------------------------------
  function loginView(note) {
    root.innerHTML = `<div class="login-box"><h2>Admin sign in</h2>${note ? `<div class="alert warn">${esc(note)}</div>` : ''}<form class="form" id="lf"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="btn btn-primary">Sign in</button><p class="form-msg err" role="alert"></p></form><p class="small muted"><a href="/">Back to the website</a></p></div>`;
    $('#lf').addEventListener('submit', async (e) => {
      e.preventDefault(); const msg = $('.form-msg', e.target);
      try { const r = await api('/api/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); me = { user: r.user, csrf: r.csrf }; start(); }
      catch (err) { msg.textContent = err.message; }
    });
  }

  // ---- shell + router ---------------------------------------------------------------------------------------------
  const NAV = [['dashboard', 'Dashboard'], ['products', 'Products'], ['orders', 'Orders & payments'], ['customers', 'Customers'], ['messages', 'Messages'], ['|', 'Website'], ['content', 'Website content'], ['social', 'Social links'], ['payments', 'Payments, bank & tax'], ['|', 'Account'], ['security', 'Security & activity']];
  function shell() {
    root.innerHTML = `<div class="adm"><aside class="adm-side"><a class="brand light" href="/admin"><span class="mark">AR</span><span class="brand-name">Admin</span></a>
      ${NAV.map(([k, l]) => (k === '|' ? `<small>${l}</small>` : `<a data-nav="${k}" href="#/${k}">${l}</a>`)).join('')}<small>&nbsp;</small><a href="/" target="_blank" rel="noopener">View website</a><a id="out" href="#">Sign out</a></aside><main class="adm-main" id="view"></main></div>`;
    $('#out').addEventListener('click', async (e) => { e.preventDefault(); await api('/api/auth/logout', { method: 'POST' }); location.reload(); });
  }
  const VIEWS = { dashboard, products, orders, customers, messages, content, social, payments, security };
  async function route() {
    const [name, arg] = (location.hash.replace(/^#\//, '') || 'dashboard').split('/');
    const fn = VIEWS[name] || dashboard;
    $$('.modal-bg').forEach((m) => m.remove()); // navigating away closes any open dialog
    $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (VIEWS[name] ? name : 'dashboard')));
    const v = $('#view'); v.innerHTML = '<p class="muted">Loading&hellip;</p>';
    try { await fn(v, arg); } catch (e) { if (e.status === 401 || e.status === 403) location.reload(); else v.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  }
  async function loadSettings() { const r = await api('/api/admin/settings'); S = r.settings; SERVER = r.server; currency = S.site.currency; }
  async function start() {
    if (!me.user) return loginView();
    if (me.user.role !== 'admin') { await api('/api/auth/logout', { method: 'POST' }); me = await api('/api/me'); return loginView('That account is not an administrator.'); }
    await loadSettings(); shell(); window.addEventListener('hashchange', route); route();
  }

  // ---- dashboard ------------------------------------------------------------------------------------------------------
  async function dashboard(v) {
    const s = await api('/api/admin/stats'); currency = s.currency;
    const byDay = Object.fromEntries(s.daily.map((d) => [d.day, d]));
    const days = []; const base = Date.now() + 4 * 3600e3;
    for (let i = 29; i >= 0; i--) days.push(new Date(base - i * 86400e3).toISOString().slice(0, 10));
    const max = Math.max(1, ...days.map((d) => byDay[d]?.revenue || 0));
    const c = s.counts;
    v.innerHTML = `<div class="adm-top"><h1>Dashboard</h1><a class="btn btn-ghost btn-sm" href="/api/admin/orders.csv">Export orders (CSV)</a></div>
      <div class="stats"><div class="stat"><span>Total revenue</span><b>${money(s.revenue_minor)}</b></div><div class="stat"><span>Last 30 days</span><b>${money(s.last30_minor)}</b></div><div class="stat"><span>Paid orders</span><b>${s.paid_orders}</b></div><div class="stat"><span>Tax collected</span><b>${money(s.tax_minor)}</b></div>
      <div class="stat"><span>Awaiting transfer</span><b>${c.awaiting_transfer || 0}</b></div><div class="stat"><span>Customers</span><b>${s.customers}</b></div><div class="stat"><span>Live products</span><b>${s.products}</b></div><div class="stat"><span>Unread messages</span><b>${s.unread_messages}</b></div></div>
      ${(c.awaiting_transfer || 0) ? `<div class="alert warn"><strong>${c.awaiting_transfer} bank transfer order(s)</strong> are waiting for you to verify the payment. <a href="#/orders">Review orders</a></div>` : ''}
      <div class="panel"><h3>Revenue, last 30 days</h3><div class="bars">${days.map((d) => `<div style="height:${Math.max(2, ((byDay[d]?.revenue || 0) / max) * 100)}%" data-tip="${d}: ${money(byDay[d]?.revenue || 0)}"></div>`).join('')}</div><div class="axis"><span>${days[0]}</span><span>${days[29]}</span></div></div>
      <div class="cols"><div class="panel"><h3>Top products</h3>${s.top.length ? `<table class="tbl"><thead><tr><th>Product</th><th>Sold</th><th class="r">Revenue</th></tr></thead><tbody>${s.top.map((t) => `<tr><td>${esc(t.title)}</td><td>${t.units}</td><td class="r">${money(t.revenue)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No sales yet.</p>'}</div>
      <div class="panel"><h3>Monthly sales</h3>${s.monthly.length ? `<table class="tbl"><thead><tr><th>Month</th><th>Orders</th><th class="r">Revenue</th></tr></thead><tbody>${s.monthly.map((m) => `<tr><td>${esc(m.month)}</td><td>${m.orders}</td><td class="r">${money(m.revenue)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No sales yet.</p>'}</div></div>
      <div class="panel"><h3>Recent orders</h3>${s.recent.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Order</th><th>Customer</th><th>Method</th><th>Total</th><th>Status</th><th>Date</th></tr></thead><tbody>${s.recent.map((o) => `<tr><td>${esc(o.number)}</td><td>${esc(o.billing_name)}</td><td>${o.method === 'card' ? 'Card' : 'Bank transfer'}</td><td>${money(o.total_minor, o.currency)}</td><td>${pill(o.status)}</td><td>${dt(o.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No orders yet.</p>'}</div>
      <div class="panel"><h3>System status</h3><dl class="kv"><dt>Card payments</dt><dd>${SERVER.stripe_configured ? `Stripe connected (${esc(SERVER.stripe_mode)} mode)` : '<strong>Not configured.</strong> Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET'}</dd><dt>Bank transfer</dt><dd>${S.bank.holder && S.bank.iban ? 'Ready' : '<strong>Add your bank details</strong> under Payments, bank &amp; tax'}</dd><dt>Email (receipts, resets)</dt><dd>${SERVER.smtp_enabled ? 'Configured' : 'Not configured (optional)'}</dd><dt>HTTPS</dt><dd>${SERVER.https ? 'On' : '<strong>Off.</strong> Set BASE_URL to your https:// address before going live'}</dd></dl></div>`;
  }

  // ---- products --------------------------------------------------------------------------------------------------------------
  async function products(v, arg) {
    if (arg) return productEditor(v, arg === 'new' ? null : Number(arg));
    const { products: list } = await api('/api/admin/products');
    v.innerHTML = `<div class="adm-top"><h1>Products</h1><a class="btn btn-primary" href="#/products/new">Add product</a></div>
      <div class="panel">${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Files</th><th>Sold</th><th>Status</th><th></th></tr></thead><tbody>${list.map((p) => `<tr><td><strong>${esc(p.title)}</strong></td><td>${esc(p.category)}</td><td>${money(p.price_minor)}</td><td>${p.files.length}</td><td>${p.sales}</td><td><span class="status ${p.status === 'published' ? 'paid' : p.status === 'archived' ? 'cancelled' : 'pending'}">${esc(p.status)}</span></td><td><a class="btn btn-ghost btn-sm" href="#/products/${p.id}">Edit</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No products yet. Add your first product, upload its file(s), then publish it.</p>'}</div>`;
  }

  async function productEditor(v, id) {
    let p = null;
    if (id) { p = (await api('/api/admin/products')).products.find((x) => x.id === id); if (!p) { v.innerHTML = '<div class="alert err">Product not found.</div>'; return; } }
    const val = (k, d = '') => esc(p ? p[k] ?? d : d);
    v.innerHTML = `<div class="adm-top"><h1>${p ? 'Edit product' : 'New product'}</h1><a class="btn btn-ghost btn-sm" href="#/products">Back to products</a></div>
    <form id="pf" class="panel"><div class="fgrid">
      <label class="full">Title<input name="title" value="${val('title')}" required maxlength="150"></label>
      <label>Price (${esc(currency)})<input name="price" inputmode="decimal" value="${p ? (p.price_minor / 100).toFixed(2) : ''}" placeholder="49.00" required><span class="help">Required. Minimum 2.00.</span></label>
      <label>Original price (optional, shown crossed out)<input name="compare_at" inputmode="decimal" value="${p && p.compare_at_minor ? (p.compare_at_minor / 100).toFixed(2) : ''}"></label>
      <label>Category<input name="category" list="cats" value="${val('category', S.categories[0] || 'General')}"><datalist id="cats">${S.categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label>Status<select name="status"><option value="draft"${!p || p.status === 'draft' ? ' selected' : ''}>Draft (hidden)</option><option value="published"${p && p.status === 'published' ? ' selected' : ''}>Published (visible, for sale)</option><option value="archived"${p && p.status === 'archived' ? ' selected' : ''}>Archived (hidden)</option></select><span class="help">A product can only be published after at least one file is uploaded.</span></label>
      <label class="full">Short description<input name="short_desc" value="${val('short_desc')}" maxlength="300"></label>
      <label class="full">Full description<textarea name="description" rows="9">${val('description')}</textarea><span class="help">Blank line = new paragraph. Start a line with "# " for a heading and "- " for bullet points.</span></label>
      <label>Tags (comma separated, used by search)<input name="tags" value="${val('tags')}"></label>
      <label>URL slug (optional)<input name="slug" value="${val('slug')}" placeholder="auto from title"></label>
      <label>SEO title (optional)<input name="seo_title" value="${val('seo_title')}" maxlength="70"></label>
      <label>SEO description (optional)<input name="seo_desc" value="${val('seo_desc')}" maxlength="200"></label>
      <label class="check full"><input type="checkbox" name="featured"${p && p.featured ? ' checked' : ''}> Feature on the homepage</label>
      <div class="full"><strong>Product image</strong><div class="row" style="margin-top:8px"><img class="thumb-prev" id="imgprev" alt="" ${p && p.image ? `src="${esc(p.image)}"` : 'hidden'}><div class="grow"><input type="hidden" name="image" value="${val('image')}"><input type="file" id="imgfile" accept="image/png,image/jpeg,image/gif,image/webp"><span class="help">PNG, JPG, GIF or WebP up to 5 MB. Shown on cards and product page.</span> <button type="button" class="link-btn" id="imgclear">Remove image</button></div></div></div>
    </div><div class="row" style="margin-top:16px"><button class="btn btn-primary">${p ? 'Save changes' : 'Create product (as draft)'}</button>${p ? '<button type="button" class="btn btn-danger btn-sm" id="del">Delete / archive</button>' : ''}${p && p.status === 'published' ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="/product/${esc(p.slug)}">View on website</a>` : ''}</div></form>
    ${p ? `<div class="panel"><h3>Product files (what customers download after paying)</h3><p class="muted small">Files are stored privately on the server and are never reachable by a public URL. Allowed: HTML, ZIP, PDF, Excel, Word, PowerPoint, images and more. Max ${SERVER.max_upload_mb} MB each.</p><div id="files">${filesHtml(p.files)}</div><input type="file" id="up" multiple><div class="progress" id="prog" hidden><i></i></div><p class="help" id="upmsg"></p></div>` : '<div class="alert info">After you create the product you can upload its downloadable files here.</div>'}`;

    $('#imgfile').addEventListener('change', guard(async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const res = await fetch('/api/admin/images', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': me.csrf, 'Content-Type': 'application/octet-stream' }, body: f });
      const j = await res.json(); if (!res.ok) throw new Error(j.error);
      $('#pf [name=image]').value = j.path; $('#imgprev').src = j.path; $('#imgprev').hidden = false; toast('Image uploaded. Save to apply.', 'ok');
    }));
    $('#imgclear').addEventListener('click', () => { $('#pf [name=image]').value = ''; $('#imgprev').hidden = true; });
    $('#pf').addEventListener('submit', guard(async (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.featured = e.target.featured.checked;
      const r = await api(p ? `/api/admin/products/${p.id}` : '/api/admin/products', { method: p ? 'PUT' : 'POST', body: d });
      toast('Saved', 'ok'); if (!p) location.hash = `#/products/${r.product.id}`; else productEditor(v, p.id);
    }));
    if (p) {
      $('#del').addEventListener('click', guard(async () => {
        if (!confirm('Delete this product? If customers have bought it, it will be archived instead so they keep their downloads.')) return;
        const r = await api(`/api/admin/products/${p.id}`, { method: 'DELETE' }); toast(r.archived ? 'Product archived (it has sales)' : 'Product deleted', 'ok'); location.hash = '#/products';
      }));
      $('#files').addEventListener('click', guard(async (e) => {
        const b = e.target.closest('[data-delf]'); if (!b) return;
        if (!confirm('Delete this file? Customers who already bought the product will no longer be able to download it.')) return;
        await api(`/api/admin/files/${b.dataset.delf}`, { method: 'DELETE' }); productEditor(v, p.id);
      }));
      $('#up').addEventListener('change', guard(async (e) => {
        const prog = $('#prog'); const bar = $('i', prog); const msg = $('#upmsg');
        for (const f of e.target.files) {
          prog.hidden = false; bar.style.width = '0'; msg.textContent = `Uploading ${f.name}…`;
          await upload(p.id, f, (x) => { bar.style.width = `${Math.round(x * 100)}%`; });
        }
        toast('Upload complete', 'ok'); productEditor(v, p.id);
      }));
    }
  }
  const filesHtml = (files) => (files.length ? `<table class="tbl"><thead><tr><th>File</th><th>Size</th><th>Uploaded</th><th></th></tr></thead><tbody>${files.map((f) => `<tr><td>${esc(f.original_name)}</td><td>${size(f.size)}</td><td>${dt(f.created_at)}</td><td class="r"><a class="btn btn-ghost btn-sm" href="/api/admin/files/${f.id}/download">Test download</a> <button class="btn btn-danger btn-sm" data-delf="${f.id}">Delete</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No files yet. Upload at least one before publishing.</p>');
  function upload(id, file, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api/admin/products/${id}/files?name=${encodeURIComponent(file.name)}`);
      x.setRequestHeader('X-CSRF-Token', me.csrf); x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { /* not json */ } x.status < 300 ? resolve(j) : reject(new Error(j.error || 'Upload failed')); };
      x.onerror = () => reject(new Error('Network error during upload'));
      x.send(file);
    });
  }

  // ---- orders & payments --------------------------------------------------------------------------------------------------------
  async function orders(v) {
    v.innerHTML = `<div class="adm-top"><h1>Orders &amp; payments</h1><a class="btn btn-ghost btn-sm" href="/api/admin/orders.csv">Export CSV</a></div>
      <form class="panel row" id="of"><select name="status" style="max-width:220px"><option value="">All statuses</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><input name="q" class="grow" placeholder="Search order number, name or email"><button class="btn btn-primary">Filter</button></form><div id="ol"></div>`;
    const load = guard(async () => {
      const q = new URLSearchParams(Object.fromEntries(new FormData($('#of'))));
      const { orders: rows } = await api(`/api/admin/orders?${q}`);
      $('#ol').innerHTML = `<div class="panel">${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Order</th><th>Customer</th><th>Method</th><th>Total</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>${rows.map((o) => `<tr><td><strong>${esc(o.number)}</strong></td><td>${esc(o.billing_name)}<br><span class="muted small">${esc(o.billing_email)}</span></td><td>${o.method === 'card' ? 'Card' : 'Bank transfer'}</td><td>${money(o.total_minor, o.currency)}</td><td>${pill(o.status)}</td><td>${dt(o.created_at)}</td><td><button class="btn btn-ghost btn-sm" data-open="${o.id}">Open</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No orders match.</p>'}</div>`;
    });
    $('#of').addEventListener('submit', (e) => { e.preventDefault(); load(); });
    $('#ol').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openOrder(b.dataset.open, load); });
    load();
  }

  async function openOrder(id, refresh) {
    const m = modal('<p class="muted">Loading…</p>');
    const draw = guard(async (order) => {
      if (!order) order = (await api(`/api/admin/orders/${id}`)).order;
      const paid = order.status === 'paid';
      m.el.innerHTML = `<button class="btn btn-ghost btn-sm x" type="button">Close</button><h2>${esc(order.number)} ${pill(order.status)}</h2>
        <div class="cols"><dl class="kv"><dt>Customer</dt><dd>${esc(order.customer?.name)}<br>${esc(order.customer?.email)}${order.customer?.phone ? `<br>${esc(order.customer.phone)}` : ''}</dd><dt>Method</dt><dd>${order.method === 'card' ? 'Card (Stripe)' : 'Bank transfer'}</dd><dt>Created</dt><dd>${dt(order.created_at)}</dd><dt>Paid</dt><dd>${order.paid_at ? dt(order.paid_at) : '—'}</dd></dl>
        <dl class="kv"><dt>Subtotal</dt><dd>${money(order.subtotal_minor, order.currency)}</dd><dt>Tax (${order.tax_rate}%)</dt><dd>${money(order.tax_minor, order.currency)}</dd><dt><strong>Total</strong></dt><dd><strong>${money(order.total_minor, order.currency)}</strong></dd></dl></div>
        <h3 style="margin-top:18px">Items &amp; download permissions</h3>${order.items.map((it) => `<div class="panel"><div class="row"><strong class="grow">${esc(it.title)}</strong><span>${money(it.unit_minor, order.currency)}</span></div>
          ${it.locked ? '<p class="muted small">Locked: no download permission until payment is verified.</p>' : `<p class="small">${it.revoked ? '<strong>Access revoked.</strong> ' : ''}Allowance: ${it.max_downloads} downloads per file. ${it.files.map((f) => `<br>• ${esc(f.name)}: ${f.downloads_left} left`).join('')}</p><div class="row"><button class="btn btn-ghost btn-sm" data-g="${it.grant_id}" data-a="${it.revoked ? 'restore' : 'revoke'}">${it.revoked ? 'Restore access' : 'Revoke access'}</button><button class="btn btn-ghost btn-sm" data-g="${it.grant_id}" data-a="reset">Reset download counts</button><button class="btn btn-ghost btn-sm" data-g="${it.grant_id}" data-a="extend">+5 downloads</button></div>`}</div>`).join('')}
        <h3>Payments</h3>${order.payments.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Provider</th><th>Status</th><th>Amount</th><th>Reference</th><th>Note</th><th>Date</th></tr></thead><tbody>${order.payments.map((p) => `<tr><td>${esc(p.provider)}</td><td>${esc(p.status)}</td><td>${money(p.amount_minor, p.currency)}</td><td class="small">${esc(p.provider_ref || '')}</td><td class="small">${esc(p.detail || '')}</td><td>${dt(p.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No payment records.</p>'}
        ${order.downloads?.length ? `<h3 style="margin-top:18px">Recent downloads</h3><p class="small">${order.downloads.map((d) => `${dt(d.created_at)}: ${esc(d.original_name || '')} (${esc(d.ip || '')})`).join('<br>')}</p>` : ''}
        <div class="panel" style="margin-top:18px"><h3>Actions</h3>
          ${!paid && order.status !== 'refunded' ? `<div class="alert ${order.method === 'bank_transfer' ? 'info' : 'warn'}">${order.method === 'bank_transfer' ? 'Check your bank statement. Only confirm once the money has arrived.' : 'Card orders are marked paid automatically by Stripe. Only confirm manually if you verified the payment in your Stripe dashboard.'}</div><div class="row"><input id="note" class="grow" placeholder="Bank reference or note (required)"><button class="btn btn-primary" id="markpaid">Confirm payment received &amp; unlock downloads</button></div>` : ''}
          <div class="row" style="margin-top:10px">${paid ? '<button class="btn btn-danger btn-sm" id="refund">Mark as refunded (disables downloads)</button>' : ''}${!paid && !['cancelled', 'refunded'].includes(order.status) ? '<button class="btn btn-ghost btn-sm" id="cancel">Cancel order</button>' : ''}</div>
          ${paid ? '<p class="help">Refunding here does not move money. Refund the customer in Stripe or from your bank, then mark it refunded.</p>' : ''}</div>`;
      $('.x', m.el).addEventListener('click', () => { m.close(); refresh && refresh(); });
      $$('[data-g]', m.el).forEach((b) => b.addEventListener('click', guard(async () => { const r = await api(`/api/admin/grants/${b.dataset.g}`, { method: 'POST', body: { action: b.dataset.a } }); r.order.customer = order.customer; toast('Updated', 'ok'); draw(r.order); })));
      const act = (sel, path, body, confirmMsg) => { const b = $(sel, m.el); if (b) b.addEventListener('click', guard(async () => { if (confirmMsg && !confirm(confirmMsg)) return; const r = await api(`/api/admin/orders/${id}/${path}`, { method: 'POST', body }); r.order.customer = order.customer; toast('Order updated', 'ok'); draw(r.order); })); };
      const mp = $('#markpaid', m.el);
      if (mp) mp.addEventListener('click', guard(async () => { const note = $('#note', m.el).value; if (!confirm('Confirm that the payment has been received? This unlocks the downloads.')) return; const r = await api(`/api/admin/orders/${id}/mark-paid`, { method: 'POST', body: { note } }); r.order.customer = order.customer; toast('Marked as paid. Downloads unlocked.', 'ok'); draw(r.order); }));
      act('#refund', 'refund', {}, 'Mark this order as refunded and disable downloads?');
      act('#cancel', 'cancel', {}, 'Cancel this unpaid order?');
    });
    draw();
  }

  // ---- customers / messages ----------------------------------------------------------------------------------------------------------
  async function customers(v) {
    const { customers: rows } = await api('/api/admin/customers');
    v.innerHTML = `<div class="adm-top"><h1>Customers</h1></div><div class="panel">${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Orders</th><th>Spent</th><th></th></tr></thead><tbody>${rows.map((c) => `<tr><td>${esc(c.name)}${c.disabled ? ' <span class="status cancelled">disabled</span>' : ''}</td><td>${esc(c.email)}</td><td>${dt(c.created_at)}</td><td>${c.paid_orders}</td><td>${money(c.spent_minor)}</td><td class="r"><button class="btn btn-ghost btn-sm" data-pw="${c.id}">Set password</button> <button class="btn btn-ghost btn-sm" data-dis="${c.id}" data-v="${c.disabled ? 0 : 1}">${c.disabled ? 'Enable' : 'Disable'}</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No customers yet.</p>'}</div>`;
    v.onclick = guard(async (e) => {
      const pw = e.target.closest('[data-pw]'); const dis = e.target.closest('[data-dis]');
      if (pw) { const p = prompt('New password for this customer (8+ characters). Share it with them securely.'); if (!p) return; await api(`/api/admin/customers/${pw.dataset.pw}/password`, { method: 'POST', body: { password: p } }); toast('Password set', 'ok'); }
      if (dis) { await api(`/api/admin/customers/${dis.dataset.dis}/disable`, { method: 'POST', body: { disabled: dis.dataset.v === '1' } }); customers(v); }
    });
  }
  async function messages(v) {
    const { messages: rows } = await api('/api/admin/messages');
    v.innerHTML = `<div class="adm-top"><h1>Messages</h1></div>${rows.length ? rows.map((m) => `<div class="panel"><div class="row"><strong class="grow">${esc(m.subject || '(no subject)')}</strong><span class="muted small">${dt(m.created_at)}</span></div><p class="small muted">${esc(m.name)} &lt;<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>&gt;</p><p>${esc(m.body).replace(/\n/g, '<br>')}</p><button class="btn btn-ghost btn-sm" data-h="${m.id}" data-v="${m.handled ? 0 : 1}">${m.handled ? 'Mark as unread' : 'Mark as handled'}</button></div>`).join('') : '<div class="panel"><p class="muted">No messages yet.</p></div>'}`;
    v.onclick = guard(async (e) => { const b = e.target.closest('[data-h]'); if (!b) return; await api(`/api/admin/messages/${b.dataset.h}`, { method: 'POST', body: { handled: b.dataset.v === '1' } }); messages(v); });
  }

  // ---- website content -----------------------------------------------------------------------------------------------------------------------
  const fld = (name, label, val, type = 'text', help = '') => {
    if (type === 'check') return `<label class="check full"><input type="checkbox" name="${name}"${val ? ' checked' : ''}> ${esc(label)}</label>`;
    if (type === 'area') return `<label class="full">${esc(label)}<textarea name="${name}" rows="6">${esc(val)}</textarea>${help ? `<span class="help">${esc(help)}</span>` : ''}</label>`;
    return `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(val)}"${type === 'number' ? ' step="any" min="0"' : ''}>${help ? `<span class="help">${esc(help)}</span>` : ''}</label>`;
  };
  function collect(form) {
    const o = {};
    for (const el of $$('[name]', form)) o[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    return o;
  }
  async function saveSection(section, value) {
    const r = await api(`/api/admin/settings/${section}`, { method: 'PUT', body: value });
    S[section] = r.value; currency = S.site.currency; toast('Saved', 'ok');
  }
  function sectionPanel(title, section, fieldsHtml, note = '') {
    return `<form class="panel" data-sec="${section}"><h3>${esc(title)}</h3>${note ? `<p class="muted small">${note}</p>` : ''}<div class="fgrid">${fieldsHtml}</div><p><button class="btn btn-primary btn-sm">Save ${esc(title.toLowerCase())}</button></p></form>`;
  }
  function wireSections(v) {
    $$('form[data-sec]', v).forEach((f) => f.addEventListener('submit', guard(async (e) => { e.preventDefault(); await saveSection(f.dataset.sec, { ...S[f.dataset.sec], ...collect(f) }); })));
  }
  function listEditor(id, title, items, cols, section, blank, note = '') {
    const row = (it) => `<div class="row">${cols.map(([k, ph, area]) => (area ? `<textarea data-k="${k}" placeholder="${esc(ph)}" class="grow">${esc(it[k] || '')}</textarea>` : `<input data-k="${k}" placeholder="${esc(ph)}" value="${esc(it[k] || '')}" class="grow">`)).join('')}<button type="button" class="btn btn-ghost btn-sm" data-rm>Remove</button></div>`;
    return `<div class="panel list-edit" id="${id}"><h3>${esc(title)}</h3>${note ? `<p class="muted small">${note}</p>` : ''}<div data-rows>${items.map(row).join('')}</div><div class="row"><button type="button" class="btn btn-ghost btn-sm" data-add>Add</button><button type="button" class="btn btn-primary btn-sm" data-save>Save ${esc(title.toLowerCase())}</button></div></div>`
      + `<template id="${id}-t">${row(blank)}</template>`;
  }
  function wireList(v, id, section, cols) {
    const box = $(`#${id}`, v); const tpl = $(`#${id}-t`, v);
    box.addEventListener('click', guard(async (e) => {
      if (e.target.closest('[data-rm]')) e.target.closest('.row').remove();
      if (e.target.closest('[data-add]')) $('[data-rows]', box).insertAdjacentHTML('beforeend', tpl.innerHTML);
      if (e.target.closest('[data-save]')) {
        const rows = $$('[data-rows] .row', box).map((r) => Object.fromEntries($$('[data-k]', r).map((i) => [i.dataset.k, i.value])));
        await saveSection(section, cols.length === 1 ? rows.map((r) => r[cols[0][0]]).filter(Boolean) : rows);
      }
    }));
  }

  async function content(v) {
    await loadSettings();
    v.innerHTML = `<div class="adm-top"><h1>Website content</h1><a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">Preview website</a></div><p class="muted">Everything customers read on the site can be changed here. No code needed.</p>
    ${sectionPanel('General', 'site', fld('name', 'Site name', S.site.name) + fld('tagline', 'Tagline', S.site.tagline) + fld('currency', 'Store currency (3-letter code)', S.site.currency, 'text', 'Change only before your first sale. Existing orders keep their currency.') + fld('description', 'Default meta description (Google snippet)', S.site.description, 'area'))}
    ${sectionPanel('Homepage hero', 'hero', fld('eyebrow', 'Small heading', S.hero.eyebrow) + fld('title', 'Main headline', S.hero.title) + fld('subtitle', 'Sub-headline', S.hero.subtitle, 'area') + fld('cta_text', 'Button 1 text', S.hero.cta_text) + fld('cta_link', 'Button 1 link', S.hero.cta_link) + fld('cta2_text', 'Button 2 text (blank to hide)', S.hero.cta2_text) + fld('cta2_link', 'Button 2 link', S.hero.cta2_link))}
    ${sectionPanel('Promotional banner', 'promo', fld('enabled', 'Show the banner on the homepage', S.promo.enabled, 'check') + fld('title', 'Title', S.promo.title) + fld('text', 'Text', S.promo.text, 'area') + fld('cta_text', 'Button text (blank to hide)', S.promo.cta_text) + fld('cta_link', 'Button link', S.promo.cta_link))}
    ${sectionPanel('About page', 'about', fld('title', 'Page title', S.about.title) + fld('body', 'Content', S.about.body, 'area', 'Blank line = new paragraph. "# Heading" for headings, "- item" for bullets.'))}
    ${sectionPanel('Contact details', 'contact', fld('email', 'Public email', S.contact.email, 'email') + fld('phone', 'Phone', S.contact.phone) + fld('address', 'Address', S.contact.address, 'area') + fld('hours', 'Opening hours / response time', S.contact.hours))}
    ${sectionPanel('Footer', 'footer', fld('text', 'Footer description', S.footer.text))}
    ${listEditor('faq', 'FAQ', S.faq, [['q', 'Question'], ['a', 'Answer', true]], 'faq', { q: '', a: '' })}
    ${listEditor('nav', 'Navigation menu', S.nav, [['label', 'Label'], ['href', 'Link (e.g. /shop or https://…)']], 'nav', { label: '', href: '' }, 'Add links to extra pages (for example your CV maker) here.')}
    ${listEditor('cats', 'Product categories', S.categories.map((c) => ({ c })), [['c', 'Category name']], 'categories', { c: '' })}
    <form class="panel" data-sec-str="privacy"><h3>Privacy Policy</h3><p class="muted small">Starter text. Have a legal adviser review it before launch.</p><textarea name="v" rows="12" style="width:100%">${esc(S.privacy)}</textarea><p><button class="btn btn-primary btn-sm">Save privacy policy</button></p></form>
    <form class="panel" data-sec-str="terms"><h3>Terms &amp; Conditions</h3><p class="muted small">Starter text. Have a legal adviser review it before launch.</p><textarea name="v" rows="12" style="width:100%">${esc(S.terms)}</textarea><p><button class="btn btn-primary btn-sm">Save terms</button></p></form>
    ${sectionPanel('Google Analytics', 'analytics', fld('ga_id', 'Measurement ID', S.analytics.ga_id, 'text', 'Looks like G-XXXXXXXXXX. Leave blank to disable. Loads only after visitors accept the cookie notice.'))}`;
    wireSections(v);
    wireList(v, 'faq', 'faq', [['q'], ['a']]); wireList(v, 'nav', 'nav', [['label'], ['href']]); wireList(v, 'cats', 'categories', [['c']]);
    $$('form[data-sec-str]', v).forEach((f) => f.addEventListener('submit', guard(async (e) => { e.preventDefault(); await saveSection(f.dataset.secStr, f.v.value); })));
  }

  // ---- social links ---------------------------------------------------------------------------------------------------------------------------------
  const SOC = [['instagram', 'Instagram', (u) => `https://www.instagram.com/${u}`], ['facebook', 'Facebook', (u) => `https://www.facebook.com/${u}`], ['tiktok', 'TikTok', (u) => `https://www.tiktok.com/@${u}`], ['youtube', 'YouTube', (u) => `https://www.youtube.com/@${u}`], ['whatsapp', 'WhatsApp', null], ['x', 'X (Twitter)', (u) => `https://x.com/${u}`], ['linkedin', 'LinkedIn', (u) => `https://www.linkedin.com/in/${u}`], ['telegram', 'Telegram', (u) => `https://t.me/${u}`], ['snapchat', 'Snapchat', (u) => `https://www.snapchat.com/add/${u}`]];
  async function social(v) {
    await loadSettings();
    v.innerHTML = `<div class="adm-top"><h1>Social links</h1></div><form class="panel" id="sf"><p class="muted">Tick a platform to show its icon in the website footer, About and Contact pages. Links open in a new tab. Check that each link opens your real profile.</p>
      <div class="row" style="margin-bottom:14px"><input id="uname" placeholder="Username" value="arazasanu1" style="max-width:260px"><button type="button" class="btn btn-ghost btn-sm" id="fill">Fill all links from this username</button></div>
      ${SOC.map(([k, l]) => `<div class="row" style="margin-bottom:10px"><label class="check" style="width:150px"><input type="checkbox" name="${k}_on"${S.social[k].enabled ? ' checked' : ''}> ${l}</label><input name="${k}_url" class="grow" value="${esc(S.social[k].url)}" placeholder="${k === 'whatsapp' ? 'https://wa.me/9715XXXXXXXX' : 'https://…'}"></div>`).join('')}
      <div class="row"><input id="wanum" placeholder="WhatsApp number with country code, e.g. 971501234567" style="max-width:380px"><span class="help">Type your number to build the WhatsApp link. A floating chat button appears on the site when WhatsApp is ticked.</span></div>
      <p style="margin-top:16px"><button class="btn btn-primary">Save social links</button></p></form>`;
    $('#fill').addEventListener('click', () => { const u = $('#uname').value.trim().replace(/^@/, ''); if (!u) return; for (const [k, , f] of SOC) if (f) { $(`[name=${k}_url]`).value = f(encodeURIComponent(u)); $(`[name=${k}_on]`).checked = true; } });
    $('#wanum').addEventListener('input', (e) => { const d = e.target.value.replace(/\D/g, ''); $('[name=whatsapp_url]').value = d ? `https://wa.me/${d}` : ''; $('[name=whatsapp_on]').checked = Boolean(d); });
    $('#sf').addEventListener('submit', guard(async (e) => { e.preventDefault(); const o = {}; for (const [k] of SOC) o[k] = { enabled: $(`[name=${k}_on]`).checked, url: $(`[name=${k}_url]`).value.trim() }; await saveSection('social', o); }));
  }

  // ---- payments, bank, tax -------------------------------------------------------------------------------------------------------------------------------
  async function payments(v) {
    await loadSettings();
    v.innerHTML = `<div class="adm-top"><h1>Payments, bank &amp; tax</h1></div>
    <div class="panel"><h3>Card payments (Stripe)</h3><dl class="kv"><dt>Status</dt><dd>${SERVER.stripe_configured ? `<strong>Connected</strong> in ${esc(SERVER.stripe_mode)} mode${SERVER.stripe_mode === 'test' ? ' (no real money moves yet)' : ''}` : '<strong>Not configured.</strong> Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to the server environment, then restart.'}</dd><dt>Webhook URL</dt><dd><span class="code">${esc(SERVER.webhook_url)}</span><br><span class="help">In Stripe: Developers &rarr; Webhooks &rarr; Add endpoint. Events to send: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, charge.refunded.</span></dd></dl></div>
    ${sectionPanel('Payment options', 'payments', fld('card_enabled', 'Offer card payments at checkout (when Stripe is connected)', S.payments.card_enabled, 'check'))}
    ${sectionPanel('Bank transfer details', 'bank', fld('enabled', 'Offer bank transfer at checkout', S.bank.enabled, 'check') + fld('show_public', 'Show details on the public Payment methods page', S.bank.show_public, 'check') + fld('holder', 'Account holder name', S.bank.holder) + fld('bank_name', 'Bank name', S.bank.bank_name) + fld('iban', 'IBAN', S.bank.iban) + fld('account_no', 'Account number (optional)', S.bank.account_no) + fld('swift', 'SWIFT / BIC', S.bank.swift) + fld('branch', 'Branch (optional)', S.bank.branch) + fld('instructions', 'Instructions shown to customers', S.bank.instructions, 'area'), 'Bank transfer is offered only when account holder and IBAN are filled in. Double-check these details: customers will send real money to them.')}
    ${sectionPanel('Tax & business details', 'tax', fld('rate', 'Tax rate % (0 = none, UAE VAT is 5)', S.tax.rate, 'number') + fld('label', 'Tax label', S.tax.label) + fld('legal_name', 'Registered business name (on receipts)', S.tax.legal_name) + fld('number', 'Tax registration number (TRN)', S.tax.number) + fld('address', 'Business address (on receipts)', S.tax.address, 'area'), 'Tax is added on top of product prices at checkout and shown on receipts.')}`;
    wireSections(v);
  }

  // ---- security & activity -----------------------------------------------------------------------------------------------------------------------------------
  async function security(v) {
    const { audit } = await api('/api/admin/audit');
    v.innerHTML = `<div class="adm-top"><h1>Security &amp; activity</h1></div>
    <form class="panel" id="pw" style="max-width:520px"><h3>Change administrator password</h3><div class="form"><label>Current password<input type="password" name="current" autocomplete="current-password" required></label><label>New password (12+ characters)<input type="password" name="password" autocomplete="new-password" minlength="12" required></label><button class="btn btn-primary">Update password</button><p class="form-msg" role="alert"></p></div></form>
    <div class="panel"><h3>Recent activity</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th><th>IP</th></tr></thead><tbody>${audit.map((a) => `<tr><td>${dt(a.created_at)}</td><td>${esc(a.email || '')}</td><td>${esc(a.action)}</td><td class="small">${esc(a.detail || '')}</td><td class="small">${esc(a.ip || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
    $('#pw').addEventListener('submit', async (e) => {
      e.preventDefault(); const msg = $('.form-msg', e.target);
      try { const r = await api('/api/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); me.csrf = r.csrf; msg.className = 'form-msg ok'; msg.textContent = 'Password updated. Other sessions were signed out.'; e.target.reset(); }
      catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
    });
  }

  (async () => { try { me = await api('/api/me'); } catch { /* handled by login */ } start(); })();
})();
