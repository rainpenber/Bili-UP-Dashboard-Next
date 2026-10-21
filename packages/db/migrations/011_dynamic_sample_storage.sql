-- WP-R2-16B: provenance for dynamic_metric_samples.
-- Idempotent. Does not add a parallel entity or sample table, and does not
-- change monitor_targets types or the (dynamic_id, sampled_at) idempotency key.
-- Existing rows receive source = import via the column default. account_id,
-- collector_run_id, and collected_at have no default and stay null. This
-- migration does not UPDATE rows and does not invent a scrape time.

ALTER TABLE dynamic_metric_samples
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'import',
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES bili_accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collector_run_id UUID REFERENCES collector_runs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE dynamic_metric_samples DROP CONSTRAINT IF EXISTS dynamic_metric_samples_source_check;
ALTER TABLE dynamic_metric_samples
  ADD CONSTRAINT dynamic_metric_samples_source_check
  CHECK (source IN ('import', 'legacy_csv', 'bilibili'));

CREATE INDEX IF NOT EXISTS dynamic_samples_run ON dynamic_metric_samples (collector_run_id);
CREATE INDEX IF NOT EXISTS dynamic_samples_source_at
  ON dynamic_metric_samples (source, sampled_at DESC);
