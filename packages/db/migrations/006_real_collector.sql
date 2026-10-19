-- WP-R2-06: real collector accounts, encrypted secrets, request audit, circuits,
-- and sample provenance. Idempotent so an existing 001–005 database can apply it twice.

CREATE TABLE IF NOT EXISTS bili_accounts (
  id UUID PRIMARY KEY,
  mid BIGINT UNIQUE,
  uname TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'blocked')),
  is_default BOOLEAN NOT NULL DEFAULT false,
  cookie_expires_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bili_accounts_one_default
  ON bili_accounts ((is_default)) WHERE is_default AND status = 'active';

CREATE TABLE IF NOT EXISTS bili_account_secrets (
  account_id UUID PRIMARY KEY REFERENCES bili_accounts (id) ON DELETE CASCADE,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  key_version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bili_login_sessions (
  id UUID PRIMARY KEY,
  qrcode_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'scanned', 'confirmed', 'expired', 'failed')),
  account_id UUID REFERENCES bili_accounts (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  error TEXT
);

CREATE TABLE IF NOT EXISTS collector_requests (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID REFERENCES bili_accounts (id) ON DELETE SET NULL,
  run_id UUID REFERENCES collector_runs (id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  status_code INT,
  biz_code INT,
  duration_ms INT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error TEXT
);

CREATE INDEX IF NOT EXISTS collector_requests_account_at
  ON collector_requests (account_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS collector_circuits (
  account_id UUID PRIMARY KEY REFERENCES bili_accounts (id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resume_at TIMESTAMPTZ NOT NULL,
  consecutive_failures INT NOT NULL DEFAULT 1,
  reason TEXT NOT NULL
);

ALTER TABLE monitor_targets DROP CONSTRAINT IF EXISTS monitor_targets_source_check;
ALTER TABLE monitor_targets
  ADD CONSTRAINT monitor_targets_source_check CHECK (source IN ('offline', 'bilibili'));
ALTER TABLE monitor_targets
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES bili_accounts (id) ON DELETE SET NULL;

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS cid BIGINT,
  ADD COLUMN IF NOT EXISTS pubdate TIMESTAMPTZ;

ALTER TABLE video_metric_samples
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'import',
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES bili_accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collector_run_id UUID REFERENCES collector_runs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE video_metric_samples DROP CONSTRAINT IF EXISTS video_metric_samples_source_check;
ALTER TABLE video_metric_samples
  ADD CONSTRAINT video_metric_samples_source_check
  CHECK (source IN ('import', 'legacy_csv', 'bilibili'));

ALTER TABLE creator_follower_samples
  ADD COLUMN IF NOT EXISTS following_count BIGINT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'import',
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES bili_accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collector_run_id UUID REFERENCES collector_runs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE creator_follower_samples DROP CONSTRAINT IF EXISTS creator_follower_samples_source_check;
ALTER TABLE creator_follower_samples
  ADD CONSTRAINT creator_follower_samples_source_check
  CHECK (source IN ('import', 'legacy_csv', 'bilibili'));

CREATE INDEX IF NOT EXISTS video_samples_run ON video_metric_samples (collector_run_id);
CREATE INDEX IF NOT EXISTS creator_samples_run ON creator_follower_samples (collector_run_id);
CREATE INDEX IF NOT EXISTS video_samples_source_at ON video_metric_samples (source, sampled_at DESC);
