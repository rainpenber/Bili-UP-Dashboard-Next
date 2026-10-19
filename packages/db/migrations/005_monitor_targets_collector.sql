-- WP-R2-05: monitor targets, collector jobs, runs, and heartbeats.
-- Commercial monitor_jobs (004) stays a publish-side pending record and is not consumed here.

CREATE TABLE IF NOT EXISTS monitor_targets (
  id UUID PRIMARY KEY,
  "type" TEXT NOT NULL CHECK ("type" IN ('video', 'creator')),
  external_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  interval_minutes INT NOT NULL CHECK (interval_minutes IN (5, 15, 30, 60, 180, 360, 720, 1440)),
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  source TEXT NOT NULL DEFAULT 'offline' CHECK (source = 'offline'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT monitor_targets_external_id_chk CHECK (
    ("type" = 'video' AND external_id ~ '^BV[1-9A-HJ-NP-Za-km-z]{10}$')
    OR ("type" = 'creator' AND external_id ~ '^[1-9][0-9]{0,18}$')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS monitor_targets_active_identity
  ON monitor_targets ("type", external_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS monitor_targets_due
  ON monitor_targets (next_run_at)
  WHERE deleted_at IS NULL AND enabled = true;

CREATE TABLE IF NOT EXISTS collector_jobs (
  id UUID PRIMARY KEY,
  target_id UUID NOT NULL REFERENCES monitor_targets (id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  scheduled_for TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS collector_jobs_pending
  ON collector_jobs (scheduled_for, id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS collector_runs (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES collector_jobs (id),
  target_id UUID NOT NULL REFERENCES monitor_targets (id),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  samples_written INT NOT NULL DEFAULT 0 CHECK (samples_written >= 0),
  duration_ms INT NOT NULL CHECK (duration_ms >= 0),
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS collector_runs_job_finished
  ON collector_runs (job_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS collector_heartbeats (
  instance_id TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('starting', 'idle', 'running', 'stopped')),
  current_job_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
