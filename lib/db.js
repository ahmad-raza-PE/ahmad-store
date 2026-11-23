'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT, ua TEXT
);
CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  short_desc TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price_minor INTEGER NOT NULL,
  compare_at_minor INTEGER,
  category TEXT NOT NULL DEFAULT 'General',
  tags TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  featured INTEGER NOT NULL DEFAULT 0,
  seo_title TEXT NOT NULL DEFAULT '',
  seo_desc TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS product_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,            -- pending | awaiting_transfer | paid | failed | cancelled | refunded
  method TEXT NOT NULL,            -- card | bank_transfer
  currency TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  billing_name TEXT NOT NULL,
  billing_email TEXT NOT NULL,
  paid_at INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  title TEXT NOT NULL,
  unit_minor INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,          -- stripe | bank_transfer | manual
  provider_ref TEXT,               -- Stripe Checkout Session id
  intent_ref TEXT,                 -- Stripe PaymentIntent id (for refunds)
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,            -- created | succeeded | failed | mismatch | refunded | expired
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments(provider_ref);
CREATE TABLE IF NOT EXISTS processed_events (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS download_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  max_downloads INTEGER NOT NULL,
  reset_at INTEGER NOT NULL DEFAULT 0,   -- downloads are counted per file since this time
  expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS download_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id INTEGER, file_id INTEGER, user_id INTEGER,
  ip TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, email TEXT, subject TEXT, body TEXT,
  handled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, action TEXT NOT NULL, detail TEXT, ip TEXT,
  created_at INTEGER NOT NULL
);
`;

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'private'), { recursive: true }); // paid files: never served statically
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });  // public product images only
  const db = new DatabaseSync(path.join(dataDir, 'store.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const clean = (p) => p.map((v) => (v === undefined ? null : v));

  return {
    raw: db,
    all: (sql, ...p) => stmt(sql).all(...clean(p)).map((r) => ({ ...r })),
    get: (sql, ...p) => { const r = stmt(sql).get(...clean(p)); return r ? { ...r } : undefined; },
    run: (sql, ...p) => {
      const r = stmt(sql).run(...clean(p));
      return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
    },
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const out = fn(); db.exec('COMMIT'); return out; }
      catch (e) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
    },
    close: () => db.close(),
  };
}

module.exports = { open };
