# Stripe checkout — Amam's setup checklist

The code is built and waiting on a branch (`stripe-checkout-test`). It runs in
**TEST mode** — no real money can move until you say go. Nothing here connects
your bank. That part is yours, in the Stripe dashboard, when you're ready.

## What you need to do (in this order)

### 1. Create a Stripe account (5 min)
- Go to **stripe.com** and sign up.
- In the dashboard, make sure **"Test mode"** is ON (toggle, top right). Stay in
  test mode for now.

### 2. Create the $9.99/month product (3 min)
- **Product catalogue → Create product**
  - Name: `The Family Ground Membership`
  - Price: `$9.99`, recurring **monthly**, USD
- Copy the **Price ID** (starts with `price_`). Save it — you'll paste it below.
- Keep a copy of all keys in your Secure Vault too.

### 3. Get your test API keys (2 min)
- **Developers → API keys** (still in test mode)
- Copy the **Secret key** (starts with `sk_test_`). This is secret — never share
  it, never paste it into the website code.

### 4. Get your Supabase service key (2 min)
- Supabase dashboard → your project → **Project Settings → API**
- Copy the **service_role** key (secret). The website already has the public key;
  this one lets the payment webhook mark members as paid.

### 5. Run the new database step (3 min)
- Supabase → **SQL Editor → New query**
- Paste the whole `schema.sql` file from the repo and **Run**. (Safe to re-run —
  it only adds the membership columns.)

### 6. Add the keys to Netlify (5 min)
- Netlify → your site → **Site settings → Environment variables**
- Add these (paste the values, no quotes):
  - `STRIPE_SECRET_KEY` → the `sk_test_...` key
  - `STRIPE_PRICE_ID` → the `price_...` ID
  - `STRIPE_WEBHOOK_SECRET` → leave empty for now, fill in step 8
  - `SUPABASE_URL` → `https://ppukwdvmwrdhnlogfvax.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` → the service_role key
  - `SITE_URL` → `https://thefamilyground.com`

### 7. Deploy the branch
- Merge the `stripe-checkout-test` branch into `main` (or tell Atlas to).
  Netlify redeploys automatically.

### 8. Connect the webhook (5 min)
- Stripe dashboard (test mode) → **Developers → Webhooks → Add endpoint**
- URL: `https://thefamilyground.com/.netlify/functions/stripe-webhook`
- Select these events:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Copy the **Signing secret** (starts with `whsec_`) → paste it into Netlify as
  `STRIPE_WEBHOOK_SECRET`, then **redeploy** (Netlify → Deploys → Trigger deploy).

### 9. Allow the membership page in Google login (2 min)
- Supabase → **Authentication → URL Configuration → Redirect URLs**
- Add: `https://thefamilyground.com/membership.html`
  (So "log in to finish joining" lands back on the membership page.)

### 10. Test it (5 min)
- Open `https://thefamilyground.com/membership.html`, click **Join for $9.99/month**
- Pay with the Stripe test card: **4242 4242 4242 4242**, any future date, any CVC
- You should land on "You're in!" → **Go to My Home** → the join banner is gone
- In Supabase → Table Editor → `profiles`, your row should show
  `membership_status = active`

## Going LIVE later (only when you approve)

1. Stripe dashboard → turn **off** test mode → finish business onboarding:
   **Settings → Payouts → add your bank account**. (Only you can do this.)
2. Create the **live** $9.99/month product + price (same as step 2, in live mode).
3. In Netlify, replace the three Stripe values with the **live** ones
   (`sk_live_...`, live `price_...`, live `whsec_...` from a new live webhook
   endpoint). Redeploy.
4. Do one real signup yourself to confirm money flows, then tell Atlas.

## What the code does

- `membership.html` — the pitch page ($9.99/mo, "less than two cups of coffee").
  The Join button calls a secure server function, then sends the member to
  Stripe's own checkout page. Card details never touch our site.
- `netlify/functions/create-checkout.js` — creates the Stripe Checkout Session
  for the logged-in parent. Kids' accounts are blocked from paying.
- `netlify/functions/stripe-webhook.js` — Stripe calls this after payment. It
  marks the parent `active` in the database (and `past_due` / `canceled` if a
  payment fails or they cancel). This is the ONLY thing allowed to change
  membership status — members can't edit it themselves.
- `dashboard.html` — shows a "Become a member" banner until the webhook marks
  the parent active, then it disappears.
