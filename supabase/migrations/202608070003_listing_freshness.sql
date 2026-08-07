alter table listings
  add column if not exists published_at timestamptz;

create index if not exists listings_published_at_idx
  on listings (published_at desc)
  where published_at is not null;

comment on column listings.published_at is
  'Reliable publication timestamp supplied by the marketplace; null when unavailable.';
comment on column listings.first_seen_at is
  'First time Car Hunter discovered this source listing ID; immutable during normal scans.';
comment on column listings.last_seen_at is
  'Most recent successful observation of the listing as active.';
