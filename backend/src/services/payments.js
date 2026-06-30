import Stripe from 'stripe';
import { config } from '../config.js';

let _stripe = null;

// Lazily build the Stripe client. Returns null when no key is configured,
// so the rest of the app keeps working (payments simply respond "not configured").
export function stripe() {
  if (!config.paymentsEnabled) return null;
  if (!_stripe) _stripe = new Stripe(config.stripeSecret, { apiVersion: '2024-06-20' });
  return _stripe;
}

export function platformFee(amountCents) {
  if (!config.platformFeeBps) return 0;
  return Math.round((amountCents * config.platformFeeBps) / 10000);
}
