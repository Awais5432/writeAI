const router = require('express').Router();
const authMiddleware = require('../middleware/auth');
const db = require('../db/postgres');
const config = require('../config');
const { getStripe } = require('../services/stripe');

function stripeConfigured() {
  return !!(config.stripe.secretKey && config.stripe.proPriceId);
}

router.post('/checkout', authMiddleware, async (req, res) => {
  if (!stripeConfigured()) {
    return res.status(503).json({
      error: 'billing_not_configured',
      message: 'Online billing is not set up yet. Ask your admin to enable Stripe, or contact support.'
    });
  }

  if (req.user.plan === 'pro') {
    return res.status(400).json({
      error: 'already_pro',
      message: 'You already have Pro access.'
    });
  }

  try {
    const stripe = getStripe();
    const { email, userId } = req.user;

    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email, metadata: { userId } });
      customerId = customer.id;
      await db.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, userId]);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: config.stripe.proPriceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${config.frontendUrl || `http://localhost:${config.port}`}/app?upgraded=1`,
      cancel_url: `${config.frontendUrl || `http://localhost:${config.port}`}/app?billing=cancel`,
      metadata: { userId }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'checkout_failed', message: 'Could not create checkout session.' });
  }
});

router.post('/portal', authMiddleware, async (req, res) => {
  if (!stripeConfigured()) {
    return res.status(503).json({
      error: 'billing_not_configured',
      message: 'Billing portal is not available. Your plan was assigned by an admin.'
    });
  }

  try {
    if (!req.user.stripe_customer_id) {
      return res.status(400).json({
        error: 'no_subscription',
        message: 'No billing account found. Your Pro plan was assigned by an admin.'
      });
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer_id,
      return_url: `${config.frontendUrl || `http://localhost:${config.port}`}/app?view=settings`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: 'portal_failed', message: 'Could not open billing portal.' });
  }
});

router.post('/webhook', async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const subscription = event.data.object;

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await db.query(
          `UPDATE users SET
            plan = $1,
            stripe_subscription_id = $2,
            subscription_status = $3,
            updated_at = NOW()
          WHERE stripe_customer_id = $4`,
          [
            subscription.status === 'active' ? 'pro' : 'free',
            subscription.id,
            subscription.status,
            subscription.customer
          ]
        );
        break;

      case 'customer.subscription.deleted':
        await db.query(
          `UPDATE users SET plan = 'free', subscription_status = 'canceled', updated_at = NOW()
           WHERE stripe_customer_id = $1`,
          [subscription.customer]
        );
        break;

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).json({ error: 'webhook_handler_failed' });
  }
});

module.exports = router;
