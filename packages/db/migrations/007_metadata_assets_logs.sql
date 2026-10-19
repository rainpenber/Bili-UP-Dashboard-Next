-- WP-R2-07: video/creator metadata, asset descriptors, app logs, and backfill runs.
-- Idempotent so an existing 001–006 database can apply it twice. No network side effects.

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS cover_state TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS metadata_state TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS metadata_source TEXT,
  ADD COLUMN IF NOT EXISTS metadata_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata_error TEXT,
  ADD COLUMN IF NOT EXISTS tid INTEGER,
  ADD COLUMN IF NOT EXISTS tid_v2 INTEGER,
  ADD COLUMN IF NOT EXISTS partition_name TEXT;

ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_cover_state_check;
ALTER TABLE videos
  ADD CONSTRAINT videos_cover_state_check
  CHECK (cover_state IN ('pending', 'ok', 'failed', 'none'));

ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_metadata_state_check;
ALTER TABLE videos
  ADD CONSTRAINT videos_metadata_state_check
  CHECK (metadata_state IN ('pending', 'ok', 'failed', 'partial'));

ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_metadata_source_check;
ALTER TABLE videos
  ADD CONSTRAINT videos_metadata_source_check
  CHECK (metadata_source IS NULL OR metadata_source IN ('bilibili', 'legacy_csv', 'manual'));

-- Empty, whitespace, and placeholder labels are not partition names.
ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_partition_name_check;
ALTER TABLE videos
  ADD CONSTRAINT videos_partition_name_check
  CHECK (
    partition_name IS NULL
    OR (
      btrim(partition_name) <> ''
      AND partition_name NOT IN ('未知', '其他', '其它')
    )
  );

CREATE INDEX IF NOT EXISTS videos_tid_v2_idx ON videos (tid_v2) WHERE tid_v2 IS NOT NULL;
CREATE INDEX IF NOT EXISTS videos_tid_idx ON videos (tid) WHERE tid IS NOT NULL;

CREATE TABLE IF NOT EXISTS bili_partitions (
  tid INTEGER PRIMARY KEY,
  parent_tid INTEGER,
  name TEXT,
  source TEXT NOT NULL DEFAULT 'unknown',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bili_partitions DROP CONSTRAINT IF EXISTS bili_partitions_source_check;
ALTER TABLE bili_partitions
  ADD CONSTRAINT bili_partitions_source_check
  CHECK (source IN ('bilibili', 'import', 'manual', 'unknown'));

ALTER TABLE bili_partitions DROP CONSTRAINT IF EXISTS bili_partitions_name_check;
ALTER TABLE bili_partitions
  ADD CONSTRAINT bili_partitions_name_check
  CHECK (
    name IS NULL
    OR (
      btrim(name) <> ''
      AND name NOT IN ('未知', '其他', '其它')
    )
  );

CREATE INDEX IF NOT EXISTS videos_metadata_state_idx
  ON videos (metadata_state)
  WHERE metadata_state <> 'ok';

CREATE INDEX IF NOT EXISTS videos_cover_state_idx
  ON videos (cover_state)
  WHERE cover_state <> 'ok';

ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS face_url TEXT,
  ADD COLUMN IF NOT EXISTS metadata_state TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS metadata_source TEXT,
  ADD COLUMN IF NOT EXISTS metadata_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata_error TEXT;

ALTER TABLE creators DROP CONSTRAINT IF EXISTS creators_metadata_state_check;
ALTER TABLE creators
  ADD CONSTRAINT creators_metadata_state_check
  CHECK (metadata_state IN ('pending', 'ok', 'failed', 'partial'));

ALTER TABLE creators DROP CONSTRAINT IF EXISTS creators_metadata_source_check;
ALTER TABLE creators
  ADD CONSTRAINT creators_metadata_source_check
  CHECK (metadata_source IS NULL OR metadata_source IN ('bilibili', 'legacy_csv', 'manual'));

CREATE INDEX IF NOT EXISTS creators_metadata_state_idx
  ON creators (metadata_state)
  WHERE metadata_state <> 'ok';

CREATE TABLE IF NOT EXISTS video_tags (
  bvid TEXT NOT NULL REFERENCES videos (bvid) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'bilibili',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bvid, tag)
);

ALTER TABLE video_tags DROP CONSTRAINT IF EXISTS video_tags_source_check;
ALTER TABLE video_tags
  ADD CONSTRAINT video_tags_source_check
  CHECK (source IN ('bilibili', 'legacy_csv', 'manual'));

CREATE INDEX IF NOT EXISTS video_tags_tag_idx ON video_tags (tag);

ALTER TABLE static_assets
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'import',
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS byte_size INTEGER,
  ADD COLUMN IF NOT EXISTS width INTEGER,
  ADD COLUMN IF NOT EXISTS height INTEGER,
  ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'import';

ALTER TABLE static_assets DROP CONSTRAINT IF EXISTS static_assets_kind_check;
ALTER TABLE static_assets
  ADD CONSTRAINT static_assets_kind_check
  CHECK (kind IN ('cover', 'face', 'import', 'other'));

ALTER TABLE static_assets DROP CONSTRAINT IF EXISTS static_assets_origin_check;
ALTER TABLE static_assets
  ADD CONSTRAINT static_assets_origin_check
  CHECK (origin IN ('bilibili', 'import', 'manual'));

CREATE TABLE IF NOT EXISTS app_logs (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  instance TEXT,
  event TEXT,
  message TEXT NOT NULL,
  request_id TEXT,
  job_id UUID,
  run_id UUID,
  target_id UUID,
  context JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE app_logs DROP CONSTRAINT IF EXISTS app_logs_level_check;
ALTER TABLE app_logs
  ADD CONSTRAINT app_logs_level_check
  CHECK (level IN ('debug', 'info', 'warn', 'error'));

ALTER TABLE app_logs DROP CONSTRAINT IF EXISTS app_logs_service_check;
ALTER TABLE app_logs
  ADD CONSTRAINT app_logs_service_check
  CHECK (service IN ('api', 'collector'));

CREATE INDEX IF NOT EXISTS app_logs_ts_idx ON app_logs (ts DESC);
CREATE INDEX IF NOT EXISTS app_logs_level_ts_idx ON app_logs (level, ts DESC);
CREATE INDEX IF NOT EXISTS app_logs_run_idx ON app_logs (run_id, ts) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_logs_request_idx ON app_logs (request_id) WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS backfill_runs (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  requested INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT
);

ALTER TABLE backfill_runs DROP CONSTRAINT IF EXISTS backfill_runs_kind_check;
ALTER TABLE backfill_runs
  ADD CONSTRAINT backfill_runs_kind_check
  CHECK (kind IN ('video', 'creator'));

ALTER TABLE backfill_runs DROP CONSTRAINT IF EXISTS backfill_runs_mode_check;
ALTER TABLE backfill_runs
  ADD CONSTRAINT backfill_runs_mode_check
  CHECK (mode IN ('bvid', 'dir', 'all-missing'));

ALTER TABLE backfill_runs DROP CONSTRAINT IF EXISTS backfill_runs_status_check;
ALTER TABLE backfill_runs
  ADD CONSTRAINT backfill_runs_status_check
  CHECK (status IN ('running', 'succeeded', 'failed', 'aborted'));

ALTER TABLE backfill_runs DROP CONSTRAINT IF EXISTS backfill_runs_counts_check;
ALTER TABLE backfill_runs
  ADD CONSTRAINT backfill_runs_counts_check
  CHECK (requested >= 0 AND succeeded >= 0 AND failed >= 0 AND skipped >= 0);
