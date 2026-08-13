-- Keep production workers deployed before VIN history compatible with this schema.
-- A history refresh updates the cached row's history_fingerprint instead of adding
-- a second analysis for the same listing material and prompt version.
alter table listing_analysis
  drop constraint if exists listing_analysis_history_cache_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'listing_analysis'::regclass
      and conname = 'listing_analysis_listing_id_material_hash_prompt_version_key'
  ) then
    alter table listing_analysis
      add constraint listing_analysis_listing_id_material_hash_prompt_version_key
      unique (listing_id, material_hash, prompt_version);
  end if;
end $$;
