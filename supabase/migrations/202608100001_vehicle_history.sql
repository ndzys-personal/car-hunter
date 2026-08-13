create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  normalized_vin text not null unique check (normalized_vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  history_checked_at timestamptz,
  history_check_version text,
  history_listing_fingerprint text,
  history_seller_fingerprint text
);

alter table listings add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
create index if not exists listings_vehicle_id_idx on listings(vehicle_id) where vehicle_id is not null;

insert into vehicles(normalized_vin, first_seen_at, last_seen_at)
select upper(vin), min(first_seen_at), max(last_seen_at)
from listings
where vin ~* '^[A-HJ-NPR-Z0-9]{17}$'
group by upper(vin)
on conflict (normalized_vin) do update set
  first_seen_at = least(vehicles.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(vehicles.last_seen_at, excluded.last_seen_at);

update listings l set vehicle_id = v.id
from vehicles v where upper(l.vin) = v.normalized_vin and l.vehicle_id is null;

create or replace function preserve_vehicle_seen_bounds() returns trigger language plpgsql as $$
begin
  new.first_seen_at := least(old.first_seen_at, new.first_seen_at);
  new.last_seen_at := greatest(old.last_seen_at, new.last_seen_at);
  return new;
end $$;
drop trigger if exists vehicles_seen_bounds on vehicles;
create trigger vehicles_seen_bounds before update on vehicles
for each row execute function preserve_vehicle_seen_bounds();

alter table listing_snapshots
  add column if not exists vehicle_id uuid references vehicles(id) on delete set null,
  add column if not exists mileage_km integer,
  add column if not exists source text,
  add column if not exists source_listing_id text,
  add column if not exists vin text,
  add column if not exists title text,
  add column if not exists published_at timestamptz,
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists seller_id uuid references sellers(id) on delete set null,
  add column if not exists seller_name text,
  add column if not exists seller_type text,
  add column if not exists location text,
  add column if not exists description_hash text,
  add column if not exists listing_url text;
create index if not exists listing_snapshots_vehicle_idx on listing_snapshots(vehicle_id, captured_at);
alter table listing_snapshots drop constraint if exists listing_snapshots_listing_id_material_hash_key;
alter table listing_snapshots add constraint listing_snapshots_observation_key unique(listing_id, captured_at);

update listing_snapshots s set
  vehicle_id = l.vehicle_id,
  source = l.source,
  source_listing_id = l.source_listing_id,
  vin = upper(l.vin),
  title = l.title,
  published_at = l.published_at,
  first_seen_at = l.first_seen_at,
  last_seen_at = s.captured_at,
  seller_id = l.seller_id,
  seller_name = l.seller_name,
  seller_type = l.declared_seller_type,
  location = l.location,
  description_hash = encode(digest(s.description, 'sha256'), 'hex'),
  listing_url = l.url
from listings l where s.listing_id = l.id;

create table if not exists historical_listings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  source text not null,
  source_listing_id text,
  historical_url text not null,
  observed_at timestamptz not null,
  published_at timestamptz,
  price_pln integer,
  mileage_km integer,
  title text,
  vehicle_model text,
  location text,
  seller_external_id text,
  seller_name text,
  seller_type text,
  description_excerpt text,
  damage_status text not null default 'unknown' check (damage_status in ('damaged', 'not_damaged', 'unknown')),
  running_status text not null default 'unknown' check (running_status in ('running', 'non_running', 'unknown')),
  vin_confirmed boolean not null default false,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  evidence_url text not null,
  created_at timestamptz not null default now(),
  unique(vehicle_id, historical_url, observed_at)
);
create index if not exists historical_listings_vehicle_idx on historical_listings(vehicle_id, published_at, observed_at);

create table if not exists vehicle_history_signals (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  analysis_fingerprint text not null,
  signal_type text not null,
  severity text not null check (severity in ('info', 'warning', 'strong_warning', 'positive')),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  message_pl text not null,
  evidence_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(vehicle_id, analysis_fingerprint, signal_type)
);

alter table listing_analysis add column if not exists history_fingerprint text not null default 'none';

alter table vehicles enable row level security;
alter table historical_listings enable row level security;
alter table vehicle_history_signals enable row level security;

comment on table vehicles is 'VIN-backed vehicle identity. Listings without a valid VIN are never linked here.';
comment on table historical_listings is 'Verified public external VIN occurrences; every claim retains its evidence URL.';
comment on column vehicles.history_checked_at is 'Cache timestamp for external VIN history providers.';
