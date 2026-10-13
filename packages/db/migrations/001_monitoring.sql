-- WP-001 monitoring schema (idempotent for parallel test runners)

CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('inventory', 'dry_run', 'apply')),
  source_timezone TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  report_json JSONB,
  content_fingerprint TEXT
);

CREATE TABLE IF NOT EXISTS source_files (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  mirror TEXT NOT NULL CHECK (mirror IN ('backend', 'frontend', 'canonical')),
  file_kind TEXT NOT NULL,
  entity_key TEXT,
  row_count INT,
  UNIQUE (batch_id, relative_path, mirror)
);

CREATE TABLE IF NOT EXISTS source_file_provenance (
  id BIGSERIAL PRIMARY KEY,
  canonical_source_file_id BIGINT NOT NULL REFERENCES source_files (id) ON DELETE CASCADE,
  mirror TEXT NOT NULL CHECK (mirror IN ('backend', 'frontend')),
  mirror_sha256 TEXT NOT NULL,
  mirror_relative_path TEXT NOT NULL,
  UNIQUE (canonical_source_file_id, mirror)
);

CREATE TABLE IF NOT EXISTS import_conflicts_or_rejects (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
  source_file_id BIGINT REFERENCES source_files (id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  entity_type TEXT,
  entity_key TEXT,
  sampled_at TIMESTAMPTZ,
  message TEXT NOT NULL,
  detail JSONB
);

CREATE TABLE IF NOT EXISTS applied_source_files (
  sha256 TEXT PRIMARY KEY,
  relative_path TEXT NOT NULL,
  file_kind TEXT NOT NULL,
  entity_key TEXT,
  first_applied_batch_id UUID NOT NULL REFERENCES import_batches (id),
  last_applied_batch_id UUID NOT NULL REFERENCES import_batches (id),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creators (
  mid BIGINT PRIMARY KEY,
  uname TEXT,
  face_asset_id TEXT,
  category TEXT,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT true,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS videos (
  bvid TEXT PRIMARY KEY,
  mid BIGINT REFERENCES creators (mid),
  title TEXT,
  cover_asset_id TEXT,
  category TEXT,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT true,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dynamics (
  dynamic_id TEXT PRIMARY KEY,
  mid BIGINT REFERENCES creators (mid),
  category TEXT,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT true,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creator_follower_samples (
  id BIGSERIAL PRIMARY KEY,
  mid BIGINT NOT NULL REFERENCES creators (mid),
  sampled_at TIMESTAMPTZ NOT NULL,
  source_timezone TEXT NOT NULL,
  raw_time TEXT NOT NULL,
  timestamp_precision TEXT NOT NULL CHECK (timestamp_precision IN ('minute', 'second')),
  follower_count BIGINT NOT NULL,
  import_batch_id UUID REFERENCES import_batches (id),
  source_file_id BIGINT REFERENCES source_files (id),
  UNIQUE (mid, sampled_at)
);

CREATE TABLE IF NOT EXISTS video_metric_samples (
  id BIGSERIAL PRIMARY KEY,
  bvid TEXT NOT NULL REFERENCES videos (bvid),
  sampled_at TIMESTAMPTZ NOT NULL,
  source_timezone TEXT NOT NULL,
  raw_time TEXT NOT NULL,
  timestamp_precision TEXT NOT NULL CHECK (timestamp_precision IN ('minute', 'second')),
  view_count BIGINT,
  online_viewers BIGINT,
  online_viewers_raw TEXT,
  like_count BIGINT,
  coin_count BIGINT,
  favorite_count BIGINT,
  share_count BIGINT,
  danmaku_count BIGINT,
  import_batch_id UUID REFERENCES import_batches (id),
  source_file_id BIGINT REFERENCES source_files (id),
  UNIQUE (bvid, sampled_at)
);

CREATE TABLE IF NOT EXISTS dynamic_metric_samples (
  id BIGSERIAL PRIMARY KEY,
  dynamic_id TEXT NOT NULL REFERENCES dynamics (dynamic_id),
  sampled_at TIMESTAMPTZ NOT NULL,
  source_timezone TEXT NOT NULL,
  raw_time TEXT NOT NULL,
  timestamp_precision TEXT NOT NULL CHECK (timestamp_precision IN ('minute', 'second')),
  like_count BIGINT,
  repost_count BIGINT,
  comment_count BIGINT,
  import_batch_id UUID REFERENCES import_batches (id),
  source_file_id BIGINT REFERENCES source_files (id),
  UNIQUE (dynamic_id, sampled_at)
);

CREATE TABLE IF NOT EXISTS static_assets (
  asset_id TEXT PRIMARY KEY,
  content_sha256 TEXT NOT NULL,
  mime_type TEXT,
  relative_path TEXT NOT NULL,
  import_batch_id UUID REFERENCES import_batches (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_videos_mid ON videos (mid);
CREATE INDEX IF NOT EXISTS idx_videos_category ON videos (category);
CREATE INDEX IF NOT EXISTS idx_creators_category ON creators (category);
CREATE INDEX IF NOT EXISTS idx_video_metric_samples_bvid_at ON video_metric_samples (bvid, sampled_at);
CREATE INDEX IF NOT EXISTS idx_creator_follower_samples_mid_at ON creator_follower_samples (mid, sampled_at);
CREATE INDEX IF NOT EXISTS idx_dynamic_metric_samples_id_at ON dynamic_metric_samples (dynamic_id, sampled_at);
