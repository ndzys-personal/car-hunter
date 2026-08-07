alter table sellers
  add column if not exists current_active_vehicle_count integer,
  add column if not exists historical_vehicle_count integer not null default 0,
  add column if not exists unique_makes_count integer not null default 0,
  add column if not exists company_name text,
  add column if not exists account_age_text text,
  add column if not exists business_signals jsonb not null default '[]'::jsonb,
  add column if not exists risk_explanation text;

alter table listings
  add column if not exists source_seller_id text,
  add column if not exists seller_profile_url text,
  add column if not exists seller_marketplace_data jsonb not null default '{}'::jsonb,
  add column if not exists seller_history jsonb not null default '{}'::jsonb;

alter table listing_analysis
  add column if not exists seller_risk_explanation text;

update listing_analysis
set seller_risk_explanation = coalesce(
  seller_risk_explanation,
  'Brak historycznych danych o zachowaniu sprzedającego.'
)
where seller_risk_explanation is null;

alter table listing_analysis
  alter column seller_risk_explanation set not null;

create table if not exists seller_listing_history (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete cascade,
  source_listing_id text not null,
  make text,
  model text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (seller_id, source_listing_id)
);

create index if not exists seller_listing_history_seller_idx
  on seller_listing_history (seller_id, last_seen_at desc);

alter table seller_listing_history enable row level security;

comment on column sellers.confidence is
  'Estimated dealer probability from 0 to 1; raw evidence remains in signals.';
comment on table seller_listing_history is
  'Minimal marketplace-only history of unique vehicle listings observed for a stable public seller identifier.';
