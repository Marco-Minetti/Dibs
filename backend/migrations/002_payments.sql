-- ============================================================
--  002_payments.sql — in-app payments (Stripe)
--  A buyer who has called dibs can pay the seller through the app.
--  Money moves buyer → seller via a Stripe destination charge when the
--  seller has connected a payout account; otherwise it is a direct
--  platform charge (fine for testing / cash-equivalent flows).
-- ============================================================

-- seller's Stripe Connect account (null until they onboard for payouts)
alter table users add column if not exists stripe_account_id text;

do $$ begin
  create type payment_status as enum ('pending','processing','paid','failed','refunded','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists payments (
  id                        uuid primary key default gen_random_uuid(),
  listing_id                uuid not null references listings(id) on delete cascade,
  buyer_id                  uuid not null references users(id)    on delete cascade,
  seller_id                 uuid not null references users(id)    on delete cascade,
  amount_cents              integer not null check (amount_cents >= 0),
  currency                  text    not null default 'eur',
  platform_fee_cents        integer not null default 0,
  status                    payment_status not null default 'pending',
  stripe_payment_intent_id  text unique,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- one live payment per (listing, buyer); we reuse/refresh it
  unique (listing_id, buyer_id)
);

create index if not exists payments_listing_idx on payments (listing_id);
create index if not exists payments_buyer_idx   on payments (buyer_id);
create index if not exists payments_seller_idx  on payments (seller_id);
