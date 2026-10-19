-- WP-R2-08: allow webui as a metadata/asset origin, and share one request
-- budget across collector and metadata refresh processes.
-- Idempotent: safe to apply twice on an existing 001–007 database.

ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_metadata_source_check;
ALTER TABLE videos
  ADD CONSTRAINT videos_metadata_source_check
  CHECK (metadata_source IS NULL OR metadata_source IN ('bilibili', 'legacy_csv', 'manual', 'webui'));

ALTER TABLE creators DROP CONSTRAINT IF EXISTS creators_metadata_source_check;
ALTER TABLE creators
  ADD CONSTRAINT creators_metadata_source_check
  CHECK (metadata_source IS NULL OR metadata_source IN ('bilibili', 'legacy_csv', 'manual', 'webui'));

ALTER TABLE static_assets DROP CONSTRAINT IF EXISTS static_assets_origin_check;
ALTER TABLE static_assets
  ADD CONSTRAINT static_assets_origin_check
  CHECK (origin IN ('bilibili', 'import', 'manual', 'webui'));

CREATE TABLE IF NOT EXISTS collector_rate_state (
  account_id UUID PRIMARY KEY,
  window_started_at TIMESTAMPTZ,
  count INTEGER NOT NULL DEFAULT 0,
  last_request_at TIMESTAMPTZ
);

ALTER TABLE collector_rate_state DROP CONSTRAINT IF EXISTS collector_rate_state_count_check;
ALTER TABLE collector_rate_state
  ADD CONSTRAINT collector_rate_state_count_check
  CHECK (count >= 0);
