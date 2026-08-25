import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const APP_URL = Deno.env.get('APP_URL')!
const FROM_EMAIL = Deno.env.get('FROM_EMAIL')!

const TIER_CREDITS: Record<string, number> = {
  trial: 20,
  starter: 100,
  standard: 300,
  pro: 700,
}

const PRICE_TO_TIER: Record<string, string> = {
  [Deno.env.get('STRIPE_PRICE_TRIAL') || '']: 'trial',
  [Deno.env.get('STRIPE_PRICE_STARTER') || '']: 'starter',
  [Deno.env.get('STRIPE_PRICE_STANDARD') || '']: 'standard',
  [Deno.env.get('STRIPE_PRICE_PRO') || '']: 'pro',
}

async function sendEmail(to: string, subject: string, html: string) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    })
  } catch (e) {
    console.error('Email send failed:', e)
  }
}

function generatePassword(): string {
  const arr = new Uint8Array(12)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

async function handleCheckoutCompleted(sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items'],
  })

  const email = session.customer_email || session.customer_details?.email
  if (!email) { console.error('No email in session'); return }

  const priceId = session.line_items?.data[0]?.price?.id || ''
  const tier = PRICE_TO_TIER[priceId] || 'starter'
  const credits = TIER_CREDITS[tier]

  const password = generatePassword()

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError) {
    // User may already exist (retry scenario)
    console.error('Auth user creation failed:', authError.message)
    return
  }

  const userId = authData.user.id
  const stripeCustomerId = session.customer as string
  const stripeSubscriptionId = session.subscription as string

  await supabase.from('barbers').upsert({
    id: userId,
    email,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: stripeSubscriptionId,
    tier,
    credits_remaining: credits,
    monthly_credit_allowance: credits,
    account_status: 'active',
    billing_cycle_start: new Date().toISOString(),
    low_credit_warning_sent: false,
  })

  // Trial: cancel at period end so it doesn't auto-renew
  if (tier === 'trial' && stripeSubscriptionId) {
    await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    })
  }

  await sendEmail(
    email,
    "You're in — here are your login details",
    `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#333">
      <h2 style="color:#000">Welcome to Haircut Try-On.</h2>
      <p>Your account is ready. Here are your login details:</p>
      <p style="background:#f5f5f5;padding:16px;border-radius:8px;font-family:monospace">
        <strong>Email:</strong> ${email}<br>
        <strong>Password:</strong> ${password}
      </p>
      <p><a href="${APP_URL}/login.html" style="background:#C9A84C;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block">Login to your account</a></p>
      <p>Once you're logged in you'll see your credit balance and an Open Tool button. Tap it to launch the try-on tool. Hand your device to your customer and they're ready to go.</p>
      <p>If you have any questions reply to this email.</p>
      <p style="color:#888">Made by Energise AI</p>
    </div>
    `
  )
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  // Only act on renewal invoices, not the initial payment (handled by checkout.session.completed)
  if (invoice.billing_reason !== 'subscription_cycle') return

  const stripeCustomerId = invoice.customer as string
  const { data: barber } = await supabase
    .from('barbers')
    .select('*')
    .eq('stripe_customer_id', stripeCustomerId)
    .single()

  if (!barber) return

  await supabase.from('barbers').update({
    credits_remaining: barber.credits_remaining + barber.monthly_credit_allowance,
    billing_cycle_start: new Date().toISOString(),
    low_credit_warning_sent: false,
    account_status: 'active',
  }).eq('stripe_customer_id', stripeCustomerId)
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const stripeCustomerId = subscription.customer as string
  const { data: barber } = await supabase
    .from('barbers')
    .select('*')
    .eq('stripe_customer_id', stripeCustomerId)
    .single()

  if (!barber) return

  await supabase.from('barbers').update({ account_status: 'inactive' })
    .eq('stripe_customer_id', stripeCustomerId)

  const isTrial = barber.tier === 'trial'
  await sendEmail(
    barber.email,
    isTrial ? 'Your trial has ended' : 'Your account has been paused',
    `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#333">
      <h2>${isTrial ? 'Your trial has ended.' : 'Your Haircut Try-On subscription has ended.'}</h2>
      <p>Your account is now paused.</p>
      <p><a href="${APP_URL}/#pricing" style="background:#C9A84C;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block">${isTrial ? 'Choose a plan to continue' : 'Reactivate your account'}</a></p>
      <p style="color:#888">Made by Energise AI</p>
    </div>
    `
  )
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const stripeCustomerId = invoice.customer as string
  const { data: barber } = await supabase
    .from('barbers')
    .select('email')
    .eq('stripe_customer_id', stripeCustomerId)
    .single()

  if (!barber) return

  await supabase.from('barbers').update({ account_status: 'inactive' })
    .eq('stripe_customer_id', stripeCustomerId)

  await sendEmail(
    barber.email,
    'Your account has been paused',
    `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#333">
      <h2>Your account has been paused.</h2>
      <p>We were unable to process your payment. To reactivate your account choose a plan below.</p>
      <p><a href="${APP_URL}/#pricing" style="background:#C9A84C;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block">Reactivate account</a></p>
      <p style="color:#888">Made by Energise AI</p>
    </div>
    `
  )
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return new Response(`Webhook error: ${(err as Error).message}`, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted((event.data.object as Stripe.Checkout.Session).id)
        break
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice)
        break
      default:
        break
    }
  } catch (err) {
    console.error('Event handler error:', err)
    return new Response('Handler error', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
