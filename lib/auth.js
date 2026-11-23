'use strict';
const crypto = require('crypto');
const { rand, sha256, safeEq } = require('./util');

const N = 16384;
const KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [alg, n, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: parseInt(n, 10), r: 8, p: 1 });
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

// Used when the email does not exist, so response time does not reveal whether an account exists.
const DUMMY = hashPassword('dummy-password-for-timing');
const burnTime = (password) => verifyPassword(password, DUMMY);

const DAY = 86400e3;
const lifetime = (role) => (role === 'admin' ? 12 * 3600e3 : 30 * DAY);

function createSession(db, user, req) {
  const token = rand(32);
  const now = Date.now();
  db.run(
    'INSERT INTO sessions(id_hash,user_id,csrf,created_at,expires_at,ip,ua) VALUES(?,?,?,?,?,?,?)',
    sha256(token), user.id, rand(24), now, now + lifetime(user.role), req.ip || null, String(req.headers['user-agent'] || '').slice(0, 200),
  );
  return { token, maxAgeSec: Math.floor(lifetime(user.role) / 1000) };
}

function getSession(db, token) {
  if (!token) return null;
  const row = db.get(
    `SELECT s.id_hash, s.csrf, s.expires_at, u.id, u.email, u.name, u.phone, u.role, u.disabled
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`, sha256(token),
  );
  if (!row) return null;
  if (row.expires_at < Date.now() || row.disabled) {
    db.run('DELETE FROM sessions WHERE id_hash = ?', row.id_hash);
    return null;
  }
  return {
    csrf: row.csrf,
    user: { id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role },
  };
}

const destroySession = (db, token) => token && db.run('DELETE FROM sessions WHERE id_hash = ?', sha256(token));
const destroyUserSessions = (db, userId) => db.run('DELETE FROM sessions WHERE user_id = ?', userId);

function validatePassword(pw, minLen = 8) {
  if (typeof pw !== 'string' || pw.length < minLen) return `Password must be at least ${minLen} characters.`;
  if (pw.length > 200) return 'Password is too long.';
  return null;
}

module.exports = { hashPassword, verifyPassword, burnTime, createSession, getSession, destroySession, destroyUserSessions, validatePassword, safeEq };
