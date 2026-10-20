-- WP-R2-10: checkpoints for read-only legacy CSV sync.
-- Idempotent. Sample rows are never deleted by this migration.
-- A checkpoint advances only in the same transaction as the rows it covers.

CREATE TABLE IF NOT EXISTS legacy_csv_sync_checkpoints (
  relative_path TEXT PRIMARY KEY,
  file_kind TEXT NOT NULL CHECK (file_kind IN ('video', 'follower')),
  entity_key TEXT NOT NULL,
  byte_offset BIGINT NOT NULL CHECK (byte_offset >= 0),
  prefix_sha256 TEXT NOT NULL,
  boundary_sha256 TEXT NOT NULL,
  boundary_length INTEGER NOT NULL CHECK (boundary_length >= 0 AND boundary_length <= 4096),
  header_line TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legacy_csv_sync_rounds (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  inserted INTEGER NOT NULL DEFAULT 0 CHECK (inserted >= 0),
  conflicts INTEGER NOT NULL DEFAULT 0 CHECK (conflicts >= 0),
  rejected INTEGER NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  files_seen INTEGER NOT NULL DEFAULT 0 CHECK (files_seen >= 0),
  files_skipped INTEGER NOT NULL DEFAULT 0 CHECK (files_skipped >= 0),
  files_failed INTEGER NOT NULL DEFAULT 0 CHECK (files_failed >= 0),
  error_message TEXT,
  report_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS legacy_csv_sync_rounds_started_at
  ON legacy_csv_sync_rounds (started_at DESC);
