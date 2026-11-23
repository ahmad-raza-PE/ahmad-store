'use strict';
const crypto = require('crypto');

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c]);

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';

const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function safeEq(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ }
  }
  return out;
}

function money(minor, currency = 'AED') {
  const n = (Number(minor) || 0) / 100;
  try {
    return new Intl.NumberFormat('en-AE', { style: 'currency', currency, currencyDisplay: 'code' })
      .format(n).replace(/ /g, ' ');
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

// Convert a user-typed decimal price ("49.5") into minor units (4950) without float surprises.
function toMinor(v) {
  const s = String(v ?? '').trim().replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return parseInt(w, 10) * 100 + parseInt((f + '00').slice(0, 2), 10);
}

const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

// Simple in-memory sliding-window rate limiter.
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) {
    const f = arr.filter((t) => now - t < 3600e3);
    if (f.length) hits.set(k, f); else hits.delete(k);
  }
}, 600e3).unref();

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        const e = new Error('Request body too large');
        e.status = 413;
        req.destroy();
        reject(e);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Render admin-written plain text: blank line = paragraph, "# " = heading, "- " = bullet list. Escapes everything.
function richText(text) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
  return blocks.map((b) => {
    const t = b.trim();
    if (!t) return '';
    if (t.startsWith('# ')) return `<h2>${esc(t.slice(2))}</h2>`;
    if (t.startsWith('## ')) return `<h3>${esc(t.slice(3))}</h3>`;
    const lines = t.split('\n');
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`;
    }
    return `<p>${esc(t).replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
}

module.exports = { esc, slugify, rand, sha256, safeEq, parseCookies, money, toMinor, isEmail, rateLimit, readBody, HttpError, richText };
