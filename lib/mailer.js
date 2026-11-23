'use strict';
/* Tiny SMTP client (no dependencies) for order confirmations and password resets.
   If SMTP_* is not configured, emails are skipped and the site still works. */
const net = require('net');
const tls = require('tls');
const cfg = require('./config');

const enabled = () => Boolean(cfg.SMTP.host && cfg.SMTP.from);

function reader(sock) {
  let buf = '';
  const waiters = [];
  const flush = () => {
    const m = buf.match(/^(?:\d{3}-.*\r?\n)*\d{3} .*\r?\n/);
    if (m && waiters.length) { buf = buf.slice(m[0].length); waiters.shift().resolve(m[0]); }
  };
  sock.on('data', (d) => { buf += d.toString('utf8'); flush(); });
  sock.on('error', (e) => waiters.splice(0).forEach((w) => w.reject(e)));
  sock.on('close', () => waiters.splice(0).forEach((w) => w.reject(new Error('SMTP connection closed'))));
  return { read: () => new Promise((resolve, reject) => { waiters.push({ resolve, reject }); flush(); }) };
}

const connect = (secure) => new Promise((resolve, reject) => {
  const { host, port } = cfg.SMTP;
  const s = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  s.setTimeout(20000, () => s.destroy(new Error('SMTP timeout')));
  s.once(secure ? 'secureConnect' : 'connect', () => resolve(s));
  s.once('error', reject);
});

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const headerSafe = (s) => String(s).replace(/[\r\n]+/g, ' ');

async function send({ to, subject, text }) {
  if (!enabled()) return { skipped: true };
  const { secure, user, pass, from } = cfg.SMTP;
  let sock = await connect(secure === 'tls');
  let rd = reader(sock);
  const cmd = async (line, ok) => {
    if (line) sock.write(`${line}\r\n`);
    const r = await rd.read();
    if (!r.startsWith(String(ok))) throw new Error(`SMTP: ${r.trim()}`);
    return r;
  };
  try {
    await cmd(null, 220);
    await cmd(`EHLO shop.local`, 250);
    if (secure === 'starttls') {
      await cmd('STARTTLS', 220);
      sock = tls.connect({ socket: sock, servername: cfg.SMTP.host });
      await new Promise((r, j) => { sock.once('secureConnect', r); sock.once('error', j); });
      rd = reader(sock);
      await cmd('EHLO shop.local', 250);
    }
    if (user) {
      await cmd('AUTH LOGIN', 334);
      await cmd(b64(user), 334);
      await cmd(b64(pass), 235);
    }
    const addr = (a) => (String(a).match(/<([^>]+)>/) || [null, a])[1].trim();
    await cmd(`MAIL FROM:<${addr(from)}>`, 250);
    await cmd(`RCPT TO:<${addr(to)}>`, 250);
    await cmd('DATA', 354);
    const msg = [
      `From: ${headerSafe(from)}`,
      `To: ${headerSafe(to)}`,
      `Subject: =?UTF-8?B?${b64(headerSafe(subject))}?=`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(text).replace(/(.{76})/g, '$1\r\n'),
      '.',
    ].join('\r\n');
    await cmd(msg, 250);
    await cmd('QUIT', 221).catch(() => {});
    return { sent: true };
  } finally {
    sock.destroy();
  }
}

// Never let an email problem break a purchase.
async function trySend(mail) {
  try { return await send(mail); } catch (e) { console.error('[mail] failed:', e.message); return { error: e.message }; }
}

module.exports = { enabled, send, trySend };
