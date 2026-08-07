alter table listing_analysis
  add column if not exists seller_declared_type text,
  add column if not exists seller_inferred_type text,
  add column if not exists seller_signals jsonb not null default '[]'::jsonb,
  add column if not exists analysis_confidence numeric(4,3),
  add column if not exists major_uncertainties jsonb not null default '[]'::jsonb,
  add column if not exists verification_items jsonb not null default '[]'::jsonb;

update listing_analysis
set
  seller_declared_type = coalesce(seller_declared_type, 'uncertain'),
  seller_inferred_type = coalesce(seller_inferred_type, seller_type),
  analysis_confidence = coalesce(analysis_confidence, 0.5)
where seller_declared_type is null
   or seller_inferred_type is null
   or analysis_confidence is null;

alter table listing_analysis
  alter column seller_declared_type set not null,
  alter column seller_inferred_type set not null,
  alter column analysis_confidence set not null;

comment on column listing_analysis.seller_declared_type is
  'Seller type declared by the marketplace; not an inference confidence signal.';
comment on column listing_analysis.seller_inferred_type is
  'Seller type inferred from concrete listing and seller signals.';
