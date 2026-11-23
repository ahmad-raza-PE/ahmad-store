# Deployment guide: what you need before going live

This is a real shop with a backend, so it cannot run on Netlify's static hosting (your current site). It needs a small server that keeps files and a database on a disk that survives restarts.

## 1. What you need (checklist)

| # | Item | Recommended | Rough cost |
|---|------|-------------|------------|
| 1 | **Hosting** (runs the shop) | A small Node.js host with a **persistent disk**: Render (Web Service + Disk), Railway or Fly.io (with a Volume), or a VPS (Hetzner, DigitalOcean, AWS Lightsail) | USD 5 to 10 per month |
| 2 | **Node.js 22.13 or newer** | Already included if you use the supplied `Dockerfile` | free |
| 3 | **Database** | Built in: SQLite file inside the data disk. Nothing to buy or install | free |
| 4 | **Domain name + HTTPS** | Your domain pointed at the host. Render, Railway, Fly.io give HTTPS automatically; on a VPS use Caddy (automatic HTTPS) | domain about USD 10 to 15 per year |
| 5 | **Payment gateway (cards)** | **Stripe** (hosted Checkout page, so card numbers never touch your site) | per transaction fee |
| 6 | **Bank account details** | For bank transfer: account holder, IBAN, bank name, SWIFT | free |
| 7 | **Email sender (SMTP)** | Optional but recommended: receipts and password reset emails. Any SMTP account (your domain mailbox, Brevo, Mailgun, Gmail app password) | free tier ok |
| 8 | **Business / tax details** | Registered name, address, VAT registration number (TRN) if registered, for receipts | n/a |
| 9 | **Legal review** | Have a professional review the Privacy Policy and Terms (they are starter texts) | n/a |

> Why not Netlify? Netlify serves static files and short functions. This shop must store paid files privately, keep a database and verify payments, which needs a persistent server disk.

## 2. Payment gateway: Stripe (cards)

1. Create a Stripe account and complete business verification. **Check that your business type and country are supported for your account** (Stripe availability depends on your registered business). If Stripe is not available for you, tell me which gateway you can use (for example a UAE provider such as Telr, PayTabs or Network International) and the payment adapter can be swapped. Only `lib/stripe.js` and a few lines in `lib/orders.js` would change.
2. In **Test mode**, copy the **Secret key** (`sk_test_...`) into `STRIPE_SECRET_KEY`.
3. Developers → Webhooks → **Add endpoint**:
   - URL: `https://YOUR-DOMAIN/webhooks/stripe`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`
   - Copy the **Signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
4. Do a full test purchase with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC). Confirm the order turns **Paid** and the download unlocks.
5. Only then switch to **live** keys and a live webhook (a live webhook has its own `whsec_`).

Currency is AED by default (change in Admin → Website content → General, **before the first sale**). Customers abroad can pay by card in AED; their bank converts it.

## 3. Deploy (example: Render)

1. Put this folder in a private GitHub repository (`.gitignore` already excludes secrets and data).
2. Render → New → **Web Service** → choose the repo, **Runtime: Docker** (uses the included `Dockerfile`).
3. Add a **Disk**: mount path `/data`, size 5 GB or more. (Paid files and the database live here.)
4. Environment variables (see `.env.example`):
   `BASE_URL=https://www.yourdomain.com`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12+ characters), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SMTP_*`, `TRUST_PROXY=1`.
5. Add your custom domain in Render and set the DNS records it shows.
6. Open `https://yourdomain/admin`, sign in, then **delete `ADMIN_PASSWORD` from the environment** and redeploy.

**VPS alternative:** install Node 22, copy the folder, create `.env`, run `npm start` under systemd or Docker, and put **Caddy** in front (`yourdomain.com { reverse_proxy localhost:3000 }`) for automatic HTTPS. Set `TRUST_PROXY=1`.

## 4. First-time setup inside the admin (https://yourdomain/admin)

1. **Payments, bank & tax**: enter your bank details (holder + IBAN switch on bank transfer), VAT rate (UAE VAT is 5), legal name, TRN, address.
2. **Social links**: confirm each link opens your real profile (they are pre-filled from `arazasanu1`). Add your WhatsApp number.
3. **Website content**: hero, About, FAQ, contact email/phone, menu links, categories, Google Analytics ID.
4. **Products**: Add product → upload files → set price → publish. Add a product image for better listings and sharing.
5. **Security**: change the admin password to your own.

## 5. How the money and downloads are protected

- Prices are read from the database on the server. The browser cannot change a price.
- A card order becomes **Paid** only through Stripe's **signed webhook** (HMAC checked, 5-minute replay window, amount and currency compared to your order) or a server-to-server lookup of the Checkout Session. The "success" page only asks the server for the status.
- Bank transfers become Paid only when **you** confirm them in the admin, with a reference note that is logged.
- Paid files sit in `DATA_DIR/private` under random names, outside the website folder, and are streamed only to the signed-in buyer of a paid, non-revoked order, limited to 5 downloads per file (admin can reset, extend or revoke).
- Passwords are hashed (scrypt), sessions are HttpOnly cookies, forms are CSRF-protected, login is rate-limited, all content is escaped, and strict security headers (CSP, no framing, HSTS on https) are sent.

## 6. Operations

- **Backups:** run `npm run backup` (or schedule it daily). It writes a consistent copy of the database, private files and images to `backups/`. Copy those off the server. Losing the disk without a backup would lose orders and files.
- **Updates:** deploy new code, the database upgrades itself on start.
- **Refunds:** refund the money in Stripe (the shop then marks the order refunded and disables downloads automatically), or refund by bank and click **Mark as refunded** in the admin.
- **Customer lost password:** the "Forgot password" link emails a reset (needs SMTP). Without SMTP, set a temporary password from Admin → Customers.
- **Monitoring:** watch Stripe's webhook page for failed deliveries; the shop also re-checks pending card orders with Stripe when the customer opens the order page.

## 7. Known limits (be aware)

- Tested here with a local stand-in for Stripe's API and real signed webhooks, **not against live Stripe**. The Stripe test-mode purchase in section 2 is a required step before real customers.
- No two-factor login for the admin yet. Use a long unique password.
- Sessions and rate limits live in memory/the database of one server: this design is for one server instance (fine for a small and medium shop).
- Your existing CV Maker and other tool pages were not supplied. They can be added under `public/tools/` and linked from the menu (Admin → Website content → Navigation), but the site's strict security policy blocks inline scripts, so those files need a small adjustment first.
- Social icons are simplified custom drawings; swap in official artwork in `lib/views.js` if you prefer.
- Privacy Policy and Terms are starter text, not legal advice.
