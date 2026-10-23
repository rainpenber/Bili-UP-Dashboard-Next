-- WP-R2-26D: per-item discovery skips (only_fans / detail 500 / parse errors)
-- must not fail the whole discovery round. Persist last skip summary for the UI.

ALTER TABLE creator_discovery_configs
  ADD COLUMN IF NOT EXISTS last_skipped_count INT NOT NULL DEFAULT 0
    CHECK (last_skipped_count >= 0);

ALTER TABLE creator_discovery_configs
  ADD COLUMN IF NOT EXISTS last_skips JSONB NOT NULL DEFAULT '[]'::jsonb;
