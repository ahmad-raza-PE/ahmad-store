'use strict';
/* Site content lives in the database so the owner can change it from the admin dashboard (no code edits).
   Every setting has a default here; stored values override defaults. */

const USER = 'arazasanu1';

const DEFAULTS = {
  site: {
    name: 'Ahmad Raza',
    tagline: 'Planning Engineer · Oil & Gas · Project Controls',
    description: 'Professional planning engineering and project controls resources: Excel templates, courses, CV templates and guides for Oil & Gas construction professionals.',
    currency: 'AED',
  },
  hero: {
    eyebrow: 'Planning Engineering · Project Controls · Oil & Gas',
    title: 'Build Better Projects. Plan Smarter. Grow Your Career.',
    subtitle: 'Professional planning engineering resources, Excel tools, CV templates and career solutions, created by Ahmad Raza.',
    cta_text: 'Browse the shop',
    cta_link: '/shop',
    cta2_text: 'Free planning tools',
    cta2_link: '/tools',
  },
  promo: {
    enabled: true,
    title: 'Instant digital delivery',
    text: 'Pay securely, and your download unlocks automatically once payment is verified. No waiting, no email chasing.',
    cta_text: 'See how it works',
    cta_link: '/faq',
  },
  tax: { rate: 0, label: 'VAT', number: '', legal_name: '', address: '' },
  contact: { email: '', phone: '', address: '', hours: '' },
  payments: { card_enabled: true },
  bank: {
    enabled: true,
    show_public: true,
    holder: '',
    bank_name: '',
    iban: '',
    account_no: '',
    swift: '',
    branch: '',
    instructions: 'Use your order number as the payment reference. Your downloads unlock once the transfer has reached our account and has been verified, usually within one working day.',
  },
  social: {
    instagram: { enabled: true, url: `https://www.instagram.com/${USER}` },
    facebook: { enabled: true, url: `https://www.facebook.com/${USER}` },
    tiktok: { enabled: true, url: `https://www.tiktok.com/@${USER}` },
    youtube: { enabled: true, url: `https://www.youtube.com/@${USER}` },
    whatsapp: { enabled: false, url: '' }, // set to https://wa.me/<number with country code, digits only>
    x: { enabled: true, url: `https://x.com/${USER}` },
    linkedin: { enabled: true, url: `https://www.linkedin.com/in/${USER}` },
    telegram: { enabled: true, url: `https://t.me/${USER}` },
    snapchat: { enabled: true, url: `https://www.snapchat.com/add/${USER}` },
  },
  analytics: { ga_id: '' },
  about: {
    title: 'About Ahmad Raza',
    body: `# Planning that holds up on site

I am a Planning Engineer working in Oil & Gas construction and project controls. This shop gathers the tools I use and teach: schedule and progress-tracking templates, structured courses, CV templates built for engineering roles, and practical documents.

# What you will find here

- Excel templates for progress, earned value, delay, resource and pipeline tracking
- Courses and guides that take you from beginner to confident planner
- CV templates and career resources aimed at engineering jobs in the Gulf and worldwide

# Why buy from this shop

Every product is made to be used on real projects. You pay securely, your payment is verified on our server, and your download unlocks automatically. If something does not work as described, write to me and I will make it right.`,
  },
  nav: [
    { label: 'Shop', href: '/shop' },
    { label: 'Free Tools', href: '/tools' },
    { label: 'About', href: '/about' },
    { label: 'FAQ', href: '/faq' },
    { label: 'Contact', href: '/contact' },
  ],
  categories: ['Excel Templates', 'Courses', 'CV Templates', 'Documents & Guides'],
  faq: [
    { q: 'How do I receive my product after paying?', a: 'As soon as your payment is verified on our server, the download buttons unlock on your order page and in your account. You can download from any device by signing in.' },
    { q: 'Which payment methods do you accept?', a: 'Secure card payments through Stripe, and bank transfer. Card payments are verified automatically. Bank transfers are unlocked after we confirm the funds in our account.' },
    { q: 'How long does a bank transfer take to unlock?', a: 'Normally within one working day after the transfer reaches our account. Always use your order number as the payment reference.' },
    { q: 'Is my card information safe?', a: 'Card details are entered on Stripe\'s secure checkout page. They never touch our website or servers.' },
    { q: 'How many times can I download a file?', a: 'Each purchase includes several downloads so you can use a new device or recover from a failed download. If you need more, contact us and we will reset your allowance.' },
    { q: 'Can I get a refund?', a: 'Digital products cannot be returned once downloaded, but if a file is damaged or not as described, contact us and we will fix it or refund you. See the Terms & Conditions for details.' },
    { q: 'I forgot my password.', a: 'Use "Forgot password" on the sign-in page. If you do not receive an email, contact us and we will help.' },
  ],
  privacy: `# Privacy Policy

This policy explains what information this website collects, why, and how it is protected.

# Information we collect

- Account details: your name, email address and an encrypted (hashed) password
- Order details: the products you bought, amounts, dates and payment status
- Messages you send through the contact form
- Basic technical information such as IP address and browser type, used for security and for preventing abuse

# Payments

Card payments are processed by Stripe. Your card number is entered on Stripe's page and is never stored or seen by this website. For bank transfers we only see what appears on our bank statement (such as the payer name and reference).

# How we use your information

To create your account, process orders, unlock and protect your downloads, issue receipts, answer your messages, and meet legal and accounting obligations. We do not sell your personal information.

# Cookies and analytics

We use essential cookies to keep you signed in and to protect forms against forgery. If analytics is enabled, we load it only after you accept the cookie notice.

# Retention and your rights

We keep order records for as long as required for accounting and legal purposes. You may ask us to access, correct or delete your personal data by using the contact page, subject to those obligations.

# Security

Passwords are stored using strong one-way hashing. Paid files are stored privately and can only be downloaded by the customer who bought them.

# Contact

Questions about this policy can be sent through the contact page.`,
  terms: `# Terms & Conditions

By placing an order on this website you agree to these terms.

# Products and licence

All products are digital downloads. When you buy a product you receive a personal, non-transferable licence to use it for your own work. You may not resell, share, upload or redistribute the files, in whole or in part, without written permission.

# Prices and payment

Prices are shown in the store currency and include or exclude tax as shown at checkout. Payment must be completed and verified before any download is unlocked. Card payments are verified automatically. Bank transfers are verified manually against our bank statement.

# Delivery

Digital products are delivered by download from your order page and account after payment is verified. You may download each product a limited number of times. Contact us if you need your allowance reset.

# Refunds

Because digital products can be copied once downloaded, purchases are generally non-refundable after download. If a file is corrupted, cannot be opened, or is materially different from its description, contact us within 14 days and we will repair, replace or refund it.

# Acceptable use

You agree not to attempt to bypass payment or download protections, share your account, or use the website unlawfully. We may suspend accounts that do.

# Disclaimer and liability

Templates and guides are provided as practical aids and do not replace professional judgement on your project. To the extent permitted by law, our liability is limited to the amount you paid for the product concerned.

# Governing law

These terms are governed by the laws of the United Arab Emirates, as applied in the Emirate of Abu Dhabi.

# Contact

Use the contact page for any questions about these terms.`,
  footer: { text: 'Planning Engineering and Project Controls resources.' },
};

const SOCIAL_LABELS = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', whatsapp: 'WhatsApp',
  x: 'X (Twitter)', linkedin: 'LinkedIn', telegram: 'Telegram', snapchat: 'Snapchat',
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function mergeDeep(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = k in base ? mergeDeep(base[k], over[k]) : over[k];
  return out;
}

function safeUrl(v, allowRelative) {
  const s = String(v ?? '').trim().slice(0, 500);
  if (!s) return '';
  if (allowRelative && /^\/(?!\/)[^\s]*$/.test(s)) return s;
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  return '';
}

const LONG_KEYS = new Set(['body', 'privacy', 'terms', 'a', 'description', 'instructions', 'subtitle', 'text']);

// Coerce an incoming value to the same shape as the default so a bad payload can never corrupt settings.
function sanitize(def, val, key = '') {
  if (typeof def === 'string') {
    const max = LONG_KEYS.has(key) ? 60000 : 500;
    let s = String(val ?? '').slice(0, max);
    if (!LONG_KEYS.has(key)) s = s.trim();
    if (key === 'url') s = safeUrl(s, false);
    if (key === 'href' || key.endsWith('_link')) s = safeUrl(s, true);
    return s;
  }
  if (typeof def === 'number') { const n = Number(val); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : def; }
  if (typeof def === 'boolean') return val === true || val === 'true';
  if (Array.isArray(def)) {
    if (!Array.isArray(val)) return def;
    const proto = def[0];
    return val.slice(0, 100).map((v) => (isObj(proto) ? sanitize(proto, v) : String(v ?? '').trim().slice(0, 100))).filter((v) => (isObj(v) ? Object.values(v).some(Boolean) : v));
  }
  if (isObj(def)) {
    const src = isObj(val) ? val : {};
    const out = {};
    for (const k of Object.keys(def)) out[k] = sanitize(def[k], src[k], k);
    return out;
  }
  return def;
}

function createSettings(db) {
  let cache = null;
  function load() {
    if (cache) return cache;
    const merged = clone(DEFAULTS);
    for (const row of db.all('SELECT key, value FROM settings')) {
      if (!(row.key in DEFAULTS)) continue;
      try { merged[row.key] = mergeDeep(merged[row.key], JSON.parse(row.value)); } catch { /* ignore corrupt row */ }
    }
    cache = merged;
    return cache;
  }
  return {
    get: () => load(),
    set(key, value) {
      if (!(key in DEFAULTS)) throw new Error('Unknown settings section');
      const clean = sanitize(DEFAULTS[key], value, key);
      db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(clean));
      cache = null;
      return clean;
    },
  };
}

module.exports = { createSettings, DEFAULTS, SOCIAL_LABELS };
