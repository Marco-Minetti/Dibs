-- ============================================================
--  dibs — database schema (PostgreSQL 14+)
--  Run with: npm run migrate
-- ============================================================
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ---------- schools ----------
create table if not exists schools (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  short         text,
  -- email domains that prove enrolment, e.g. {'nyu.edu','stern.nyu.edu'}
  email_domains text[] not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists schools_name_idx on schools using gin (to_tsvector('simple', name));

-- ---------- users ----------
create table if not exists users (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  email_domain text not null,
  school_id    uuid references schools(id),
  first_name   text not null,
  avatar_emoji text,
  rating       numeric(2,1) not null default 5.0,
  role         text not null default 'student',   -- student | admin
  verified_at  timestamptz,                        -- set when .edu code confirmed
  banned_at    timestamptz,                        -- trust & safety kill-switch
  created_at   timestamptz not null default now()
);
create index if not exists users_school_idx on users (school_id);

-- ---------- one-time login codes (passwordless .edu auth) ----------
-- We store an HMAC of the code (peppered with a server secret), never the code.
create table if not exists login_codes (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  code_hmac  text not null,
  first_name text,
  school_id  uuid references schools(id),
  expires_at timestamptz not null,
  attempts   int not null default 0,      -- lock after N wrong tries
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists login_codes_email_idx on login_codes (email, created_at desc);

-- ---------- refresh tokens (rotating sessions) ----------
create table if not exists refresh_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null,               -- sha256 of the opaque token
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists refresh_user_idx on refresh_tokens (user_id);
create index if not exists refresh_hash_idx on refresh_tokens (token_hash);

-- ---------- listings ----------
do $$ begin
  create type listing_status as enum ('active','on_hold','sold','removed','expired');
exception when duplicate_object then null; end $$;

create table if not exists listings (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references users(id) on delete cascade,
  school_id   uuid not null references schools(id),
  title       text not null,
  description text not null default '',
  price_cents int  not null default 0,
  is_free     boolean not null default false,
  category    text not null,
  condition   text not null,
  pickup_spot text not null,              -- my_room | my_house | around_campus
  status      listing_status not null default 'active',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,                -- auto-hidden after seller move-out
  -- full-text search column, kept in sync automatically
  search tsvector generated always as
    (to_tsvector('english', title || ' ' || coalesce(description,''))) stored
);
create index if not exists listings_feed_idx on listings (school_id, status, created_at desc);
create index if not exists listings_search_idx on listings using gin (search);
create index if not exists listings_seller_idx on listings (seller_id);

-- ---------- listing photos (2–3 per listing) ----------
create table if not exists listing_photos (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id) on delete cascade,
  owner_id   uuid not null references users(id) on delete cascade,
  url        text not null,
  position   int  not null default 0,     -- 0 = cover
  width      int,
  height     int,
  created_at timestamptz not null default now()
);
create index if not exists photos_listing_idx on listing_photos (listing_id, position);

-- ---------- favorites ----------
create table if not exists favorites (
  user_id    uuid not null references users(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- ---------- claims ("calling dibs" = a 24h hold) ----------
do $$ begin
  create type claim_status as enum ('held','confirmed','completed','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists claims (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  buyer_id   uuid not null references users(id) on delete cascade,
  status     claim_status not null default 'held',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (listing_id, buyer_id)
);

-- ---------- conversations + messages ----------
create table if not exists conversations (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id) on delete set null,
  buyer_id   uuid not null references users(id) on delete cascade,
  seller_id  uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (listing_id, buyer_id)
);
create index if not exists conv_buyer_idx  on conversations (buyer_id);
create index if not exists conv_seller_idx on conversations (seller_id);

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid not null references users(id) on delete cascade,
  body            text not null,
  created_at      timestamptz not null default now(),
  read_at         timestamptz
);
create index if not exists messages_conv_idx on messages (conversation_id, created_at);

-- ---------- trust & safety: reports + blocks ----------
create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id) on delete cascade,
  target_type text not null,              -- listing | user | message
  target_id   uuid not null,
  reason      text not null,
  detail      text,
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);

create table if not exists blocks (
  blocker_id uuid not null references users(id) on delete cascade,
  blocked_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
