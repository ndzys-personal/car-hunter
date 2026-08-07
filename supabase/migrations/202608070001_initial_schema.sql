create extension if not exists pgcrypto;

create table if not exists app_state (
  key text primary key,
  value jsonb not null,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists sellers (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('otomoto', 'olx', 'allegro')),
  source_seller_id text,
  name text,
  declared_type text not null default 'uncertain',
  likely_type text,
  confidence numeric(4,3),
  signals jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source, source_seller_id)
);

create table if not exists scan_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('baseline', 'scan')),
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  discovered_count integer not null default 0,
  processed_count integer not null default 0,
  error_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists listings (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('otomoto', 'olx', 'allegro')),
  source_listing_id text not null,
  profile_id text not null,
  deduplication_key text not null,
  url text not null,
  title text not null,
  description text not null default '',
  price_pln integer,
  year integer,
  mileage_km integer,
  make text not null,
  model text not null,
  generation text,
  variant text,
  body_type text,
  fuel_type text not null default 'unknown',
  engine_capacity_cc integer,
  power_hp integer,
  gearbox text not null default 'unknown',
  drive_type text not null default 'unknown',
  vin text,
  location text,
  seller_id uuid references sellers(id) on delete set null,
  seller_name text,
  declared_seller_type text not null default 'uncertain',
  primary_image_url text,
  raw_attributes jsonb not null default '{}'::jsonb,
  material_hash text not null,
  deterministic_score integer not null default 0,
  deterministic_breakdown jsonb not null default '{}'::jsonb,
  deterministic_rejected boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, source, source_listing_id)
);

create index if not exists listings_deduplication_key_idx on listings (deduplication_key);
create index if not exists listings_score_idx on listings (deterministic_score desc);
create index if not exists listings_last_seen_idx on listings (last_seen_at desc);
create index if not exists listings_vin_idx on listings (vin) where vin is not null;

create table if not exists listing_snapshots (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  scan_run_id uuid references scan_runs(id) on delete set null,
  material_hash text not null,
  price_pln integer,
  description text not null default '',
  raw_attributes jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  unique (listing_id, material_hash)
);

create table if not exists listing_analysis (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  material_hash text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  seller_type text not null,
  seller_confidence numeric(4,3) not null,
  likely_engine text not null,
  engine_confidence numeric(4,3) not null,
  fit_score integer not null,
  risk_score integer not null,
  total_score integer not null,
  price_assessment text not null,
  positives jsonb not null,
  red_flags jsonb not null,
  questions_for_seller jsonb not null,
  summary text not null,
  verdict text not null,
  recommended_action text not null,
  raw_response jsonb not null,
  created_at timestamptz not null default now(),
  unique (listing_id, material_hash, prompt_version)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  listing_analysis_id uuid references listing_analysis(id) on delete set null,
  material_hash text not null,
  notification_version integer not null default 1,
  reason text not null,
  total_score integer not null,
  recommended_action text not null,
  telegram_message_id text,
  notified_at timestamptz not null default now(),
  unique (listing_id, material_hash, notification_version)
);

alter table app_state enable row level security;
alter table sellers enable row level security;
alter table scan_runs enable row level security;
alter table listings enable row level security;
alter table listing_snapshots enable row level security;
alter table listing_analysis enable row level security;
alter table notifications enable row level security;

comment on table listings is 'Normalized marketplace listings. Access through the service role or explicit dashboard policies.';
