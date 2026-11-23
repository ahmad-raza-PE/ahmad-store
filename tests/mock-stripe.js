'use strict';
/* TEST-ONLY stand-in for the two Stripe REST endpoints the shop calls. It is never used in production:
   production talks to https://api.stripe.com. The tests use it to see exactly what the shop sends to Stripe
   and to simulate Stripe's answers (paid / unpaid / wrong amount). */
const http = require('http');

function start() {
  const sessions = new Map();
  let n = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (!/^Bearer sk_test_/.test(req.headers.authorization || '')) return send(401, { error: { message: 'Invalid API key' } });
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
        const p = new URLSearchParams(Buffer.concat(chunks).toString());
        let total = 0;
        for (const [k, v] of p) {
          const m = k.match(/^line_items\[(\d+)\]\[price_data\]\[unit_amount\]$/);
          if (m) total += parseInt(v, 10) * parseInt(p.get(`line_items[${m[1]}][quantity]`) || '1', 10);
        }
        const id = `cs_test_${++n}`;
        const s = { id, object: 'checkout.session', url: `https://checkout.stripe.test/pay/${id}`, status: 'open', payment_status: 'unpaid',
          amount_total: total, currency: p.get('line_items[0][price_data][currency]'), client_reference_id: p.get('client_reference_id'),
          customer_email: p.get('customer_email'), payment_intent: null, _params: Object.fromEntries(p) };
        sessions.set(id, s);
        return send(200, s);
      }
      const m = url.pathname.match(/^\/v1\/checkout\/sessions\/([\w]+)$/);
      if (req.method === 'GET' && m) {
        const s = sessions.get(m[1]);
        return s ? send(200, s) : send(404, { error: { message: 'No such session' } });
      }
      send(404, { error: { message: 'Not found' } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    sessions,
    close: () => server.close(),
  })));
}

module.exports = { start };
