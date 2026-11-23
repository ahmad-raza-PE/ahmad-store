# Digital products store

A complete marketplace for selling downloads: storefront, cart, checkout (card via Stripe + bank transfer), verified payments, protected downloads, receipts, customer accounts and an admin dashboard. No third-party npm packages: it runs on Node.js 22.13+ with its built-in SQLite.

## Run it locally (5 minutes)

```bash
cp .env.example .env        # then edit: ADMIN_EMAIL, ADMIN_PASSWORD (12+ chars), BASE_URL=http://localhost:3000
npm start
```

Open http://localhost:3000 and http://localhost:3000/admin. Card payments need Stripe keys in `.env`; bank transfer works as soon as you add bank details in the admin.

## Tests

```bash
npm test         # 51 back-end checks: payment verification, tampering, downloads, admin, security
npm run test:ui  # 22 browser checks (needs Playwright + Chrome): real clicks through the shop and admin, mobile layouts
```

## Layout

| Path | What it is |
|------|------------|
| `server.js` | HTTP server, security headers, CSRF, sessions, routing |
| `routes/api.js` | Accounts, checkout, orders, Stripe webhook, protected downloads |
| `routes/admin.js` | Admin API: products, uploads, orders, grants, reports, content |
| `routes/pages.js` | Server-rendered pages with SEO (home, shop, product, about, FAQ, contact, legal) |
| `lib/orders.js` | The only code that can mark an order paid and create download permissions |
| `lib/stripe.js` | Stripe Checkout session + webhook signature verification |
| `lib/settings.js` | Editable site content defaults (social links, bank, FAQ, legal texts) |
| `public/` | CSS, storefront JS, admin dashboard JS |
| `data/` (created at run time) | `store.sqlite`, `private/` paid files, `uploads/` images. Never web-served except images |

Read **DEPLOYMENT.md** before going live.
