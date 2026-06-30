import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { ah, ApiError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { stripe, platformFee } from '../services/payments.js';

const router = Router();

const intentSchema = z.object({ listingId: z.string().uuid() });

// ------------------------------------------------------------
//  GET /api/payments/config   (public-ish: just the publishable key)
// ------------------------------------------------------------
router.get('/config', (_req, res) => {
  res.json({
    enabled: config.paymentsEnabled,
    publishableKey: config.stripePublishableKey,
    currency: config.currency,
  });
});

// ------------------------------------------------------------
//  POST /api/payments/intent   { listingId }
//  Buyer must have called dibs first. Returns a Stripe client secret
//  the app uses to confirm the card payment.
// ------------------------------------------------------------
router.post('/intent', requireAuth, writeLimiter, validate(intentSchema), ah(async (req, res) => {
  const s = stripe();
  if (!s) throw new ApiError(503, 'payments_unconfigured', 'Payments are not set up yet');

  const me = req.user.id;
  const { listingId } = req.body;

  // Load listing + seller + this buyer's claim in one go.
  const { rows } = await query(
    `select l.*, u.stripe_account_id as seller_stripe,
            exists(select 1 from claims c
                   where c.listing_id=l.id and c.buyer_id=$2
                     and c.status in ('held','confirmed')) as has_claim
     from listings l join users u on u.id = l.seller_id
     where l.id = $1`,
    [listingId, me]
  );
  if (!rows.length) throw new ApiError(404, 'not_found');
  const l = rows[0];

  if (l.school_id !== req.user.schoolId) throw new ApiError(403, 'other_campus');
  if (l.seller_id === me)   throw new ApiError(400, 'own_listing', "That's your own listing");
  if (l.is_free)            throw new ApiError(400, 'is_free', 'This item is free — just arrange pickup');
  if (!l.has_claim)         throw new ApiError(409, 'dibs_first', 'Call dibs before paying');
  if (!['active', 'on_hold'].includes(l.status)) throw new ApiError(409, 'not_available', 'No longer available');

  const amount = l.price_cents;
  const fee = platformFee(amount);

  // Reuse an existing pending payment row if there is one.
  const existing = await query(
    `select * from payments where listing_id=$1 and buyer_id=$2`, [listingId, me]
  );
  let paymentId = existing.rows[0]?.id;

  // Build the PaymentIntent. If the seller has connected a payout account we
  // route the money to them (destination charge) and keep the platform fee.
  const piParams = {
    amount,
    currency: config.currency,
    automatic_payment_methods: { enabled: true },
    metadata: { listingId, buyerId: me, sellerId: l.seller_id },
  };
  if (l.seller_stripe) {
    piParams.transfer_data = { destination: l.seller_stripe };
    if (fee) piParams.application_fee_amount = fee;
  }

  let pi;
  if (existing.rows[0]?.stripe_payment_intent_id) {
    // refresh the amount on the existing intent (price could have changed)
    pi = await s.paymentIntents.update(existing.rows[0].stripe_payment_intent_id, { amount });
  } else {
    pi = await s.paymentIntents.create(piParams);
  }

  if (paymentId) {
    await query(
      `update payments set amount_cents=$1, platform_fee_cents=$2,
              stripe_payment_intent_id=$3, status='pending', updated_at=now()
       where id=$4`,
      [amount, fee, pi.id, paymentId]
    );
  } else {
    const ins = await query(
      `insert into payments
        (listing_id, buyer_id, seller_id, amount_cents, currency, platform_fee_cents, stripe_payment_intent_id)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [listingId, me, l.seller_id, amount, config.currency, fee, pi.id]
    );
    paymentId = ins.rows[0].id;
  }

  res.json({
    clientSecret: pi.client_secret,
    paymentId,
    amountCents: amount,
    currency: config.currency,
    publishableKey: config.stripePublishableKey,
  });
}));

// ------------------------------------------------------------
//  GET /api/payments/listing/:listingId   → this buyer's payment status
// ------------------------------------------------------------
router.get('/listing/:listingId', requireAuth, ah(async (req, res) => {
  const { rows } = await query(
    `select id, amount_cents, currency, status, updated_at
     from payments where listing_id=$1 and buyer_id=$2`,
    [req.params.listingId, req.user.id]
  );
  res.json({ payment: rows[0] || null });
}));

// ------------------------------------------------------------
//  POST /api/payments/connect   → seller payout onboarding link
//  Creates (or reuses) a Stripe Connect Express account and returns
//  a one-time onboarding URL.
// ------------------------------------------------------------
router.post('/connect', requireAuth, writeLimiter, ah(async (req, res) => {
  const s = stripe();
  if (!s) throw new ApiError(503, 'payments_unconfigured');

  const me = req.user.id;
  const { rows } = await query('select email, stripe_account_id from users where id=$1', [me]);
  let acct = rows[0].stripe_account_id;

  if (!acct) {
    const account = await s.accounts.create({
      type: 'express',
      email: rows[0].email,
      capabilities: { transfers: { requested: true } },
    });
    acct = account.id;
    await query('update users set stripe_account_id=$1 where id=$2', [acct, me]);
  }

  const base = req.headers.origin || 'https://dibs.app';
  const link = await s.accountLinks.create({
    account: acct,
    refresh_url: `${base}/?payouts=retry`,
    return_url: `${base}/?payouts=done`,
    type: 'account_onboarding',
  });
  res.json({ url: link.url });
}));

// ------------------------------------------------------------
//  POST /api/payments/webhook   (raw body — Stripe signature verified)
//  Mounted with express.raw in server.js, so req.body is a Buffer here.
// ------------------------------------------------------------
export const webhookHandler = ah(async (req, res) => {
  const s = stripe();
  if (!s) return res.json({ received: true });

  let event = req.body;
  if (config.stripeWebhookSecret) {
    const sig = req.headers['stripe-signature'];
    try {
      event = s.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);
    } catch (err) {
      return res.status(400).send(`webhook signature failed: ${err.message}`);
    }
  } else if (Buffer.isBuffer(req.body)) {
    event = JSON.parse(req.body.toString('utf8'));   // dev fallback (no secret set)
  }

  const pi = event.data?.object;
  const intentId = pi?.id;

  if (event.type === 'payment_intent.succeeded' && intentId) {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `update payments set status='paid', updated_at=now()
         where stripe_payment_intent_id=$1 returning listing_id, buyer_id`,
        [intentId]
      );
      if (rows.length) {
        const { listing_id, buyer_id } = rows[0];
        await client.query(`update listings set status='sold' where id=$1`, [listing_id]);
        await client.query(
          `update claims set status='completed'
           where listing_id=$1 and buyer_id=$2`, [listing_id, buyer_id]);
      }
    });
  } else if (event.type === 'payment_intent.payment_failed' && intentId) {
    await query(
      `update payments set status='failed', updated_at=now()
       where stripe_payment_intent_id=$1`, [intentId]);
  }

  res.json({ received: true });
});

export default router;
