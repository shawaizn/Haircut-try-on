# Setup Guide — Haircut Try-On SaaS

## Step 1 — Supabase

1. Go to [supabase.com](https://supabase.com) and open your project
2. Run the migration in **SQL Editor**:
   - Paste the contents of `supabase/migrations/001_initial_schema.sql` and execute
3. Note your **Project URL** and **anon key** from Settings → API
4. Note your **service_role key** from Settings → API

## Step 2 — Stripe

### Create products

Create four products in the Stripe dashboard (or test mode):

| Product | Price | Type |
|---------|-------|------|
| Trial | £1.00 | One-time or recurring (set `cancel_at_period_end` immediately — the webhook does this automatically) |
| Starter | £29.00/month | Recurring |
| Standard | £59.00/month | Recurring |
| Pro | £99.00/month | Recurring |

For each product, copy its **Price ID** (starts with `price_`).

### Create checkout links

For each tier, create a **Payment Link** in Stripe:
- Enable "Collect customer email" in the checkout
- Use the hosted checkout (no custom domain needed to start)
- After payment, redirect to: `https://yourdomain.com/dashboard.html`

Copy each Payment Link URL and paste it into the pricing buttons in `index.html` (replace `YOUR_STRIPE_TRIAL_URL`, etc.).

### Customer Portal

Enable the Stripe Customer Portal at Dashboard → Settings → Customer portal:
- Allow customers to: cancel subscriptions, update payment method
- Save the portal URL and paste it into `dashboard.html` as `STRIPE_CUSTOMER_PORTAL_URL`

### Webhooks

Create a webhook endpoint in Stripe → Webhooks:
- URL: `https://your-project-ref.supabase.co/functions/v1/stripe-webhook`
- Events to listen to:
  - `checkout.session.completed`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `customer.subscription.deleted`
- Copy the **Signing secret** (starts with `whsec_`)

## Step 3 — Resend

1. Go to [resend.com](https://resend.com) and create an account
2. Verify your sending domain (or use the sandbox for testing)
3. Create an API key
4. Set `FROM_EMAIL` to something like `noreply@yourdomain.com`

## Step 4 — Deploy Supabase Edge Functions

Install the Supabase CLI:
```bash
npm install -g supabase
supabase login
```

Link to your project:
```bash
supabase link --project-ref your-project-ref
```

Set secrets (replace with your actual values):
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set STRIPE_PRICE_TRIAL=price_...
supabase secrets set STRIPE_PRICE_STARTER=price_...
supabase secrets set STRIPE_PRICE_STANDARD=price_...
supabase secrets set STRIPE_PRICE_PRO=price_...
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set FROM_EMAIL=noreply@yourdomain.com
supabase secrets set APP_URL=https://yourdomain.com
```

Deploy the functions:
```bash
supabase functions deploy stripe-webhook
supabase functions deploy generate-image
supabase functions deploy demo-generate
```

## Step 5 — Configure the frontend

In each of these files, replace the placeholder constants at the top of the `<script>` section:

### `index.html`, `login.html`, `dashboard.html`, `tool.html`
```js
var SUPABASE_URL      = 'https://your-project-ref.supabase.co'
var SUPABASE_ANON_KEY = 'your-anon-key'
```

### `dashboard.html`
```js
var STRIPE_CUSTOMER_PORTAL_URL = 'https://billing.stripe.com/p/...'
```

### `index.html` (landing page — optional)
```js
var SAMPLE_PHOTO_URL = 'https://yourdomain.com/sample-face.jpg'
```
If left empty, the "Use sample photo" demo option is hidden. Set it to any publicly accessible royalty-free face photo URL.

## Step 6 — Deploy the site

Host the four HTML files (`index.html`, `login.html`, `dashboard.html`, `tool.html`) on any static host:
- **Vercel** — drag and drop or connect GitHub
- **Netlify** — same
- **Cloudflare Pages** — same
- Your own server

The site has no build step. All four files are plain HTML.

## Testing the full flow

1. Open `index.html` — landing page should load
2. Click a pricing tier → Stripe checkout opens (use test card `4242 4242 4242 4242`)
3. After payment, check Supabase `barbers` table — a record should appear
4. Check your email — welcome email should arrive from Resend
5. Login at `/login.html` with the credentials from the email
6. Dashboard loads with credit balance
7. Click "Open Tool" — try-on tool opens
8. Take a photo, select a style, tap Generate — image generates via the edge function
9. Credit balance in Supabase decreases by 1

## Demo pool management

The demo pool starts at 500 credits. To add more credits:
```sql
UPDATE demo_pool SET credits_remaining = 500 WHERE id = 1;
```

Or top up by any amount:
```sql
UPDATE demo_pool SET credits_remaining = credits_remaining + 200 WHERE id = 1;
```
