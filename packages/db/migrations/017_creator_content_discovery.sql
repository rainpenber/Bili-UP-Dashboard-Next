-- WP-R2-05A: creator content discovery, publish events, and new-video dense collect plans.
-- Additive only. Defaults keep discovery off until the user enables it explicitly.

-- Hidden scheduler target: type=discovery, external_id=mid, fixed 5-minute interval.
-- Not created via the public target API; upserted with discovery config enablement.
ALTER TABLE monitor_targets DROP CONSTRAINT IF EXISTS monitor_targets_type_check;
ALTER TABLE monitor_targets
  ADD CONSTRAINT monitor_targets_type_check
  CHECK ("type" IN ('video', 'creator', 'dynamic', 'discovery'));

ALTER TABLE monitor_targets DROP CONSTRAINT IF EXISTS monitor_targets_external_id_chk;
ALTER TABLE monitor_targets
  ADD CONSTRAINT monitor_targets_external_id_chk CHECK (
    ("type" = 'video' AND external_id ~ '^BV[1-9A-HJ-NP-Za-km-z]{10}$')
    OR ("type" = 'creator' AND external_id ~ '^[1-9][0-9]{0,18}$')
    OR ("type" = 'dynamic' AND external_id ~ '^[1-9][0-9]*$')
    OR ("type" = 'discovery' AND external_id ~ '^[1-9][0-9]{0,18}$')
  );

ALTER TABLE monitor_targets DROP CONSTRAINT IF EXISTS monitor_targets_discovery_interval_mode_chk;
ALTER TABLE monitor_targets
  ADD CONSTRAINT monitor_targets_discovery_interval_mode_chk
  CHECK ("type" <> 'discovery' OR interval_mode = 'fixed');

CREATE TABLE IF NOT EXISTS creator_discovery_configs (
  mid TEXT PRIMARY KEY
    CHECK (mid ~ '^[1-9][0-9]{0,18}$'),
  -- Master switch: when false, discovery target is disabled and polling stops.
  enabled BOOLEAN NOT NULL DEFAULT false,
  discover_videos BOOLEAN NOT NULL DEFAULT false,
  discover_dynamics BOOLEAN NOT NULL DEFAULT false,
  -- Sub-option: auto-create video monitor targets for newly discovered videos.
  monitor_new_videos BOOLEAN NOT NULL DEFAULT false,
  discovery_target_id UUID REFERENCES monitor_targets (id) ON DELETE SET NULL,
  -- Watermarks: first successful poll seeds without emitting historical events.
  video_watermark_created BIGINT,
  dynamic_watermark_pub_ts BIGINT,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  last_run_at TIMESTAMPTZ,
  suppressed_auto_create_total INT NOT NULL DEFAULT 0 CHECK (suppressed_auto_create_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT creator_discovery_configs_options_chk CHECK (
    NOT enabled OR discover_videos OR discover_dynamics
  ),
  CONSTRAINT creator_discovery_configs_monitor_requires_videos_chk CHECK (
    NOT monitor_new_videos OR discover_videos
  )
);

CREATE INDEX IF NOT EXISTS creator_discovery_configs_enabled
  ON creator_discovery_configs (enabled)
  WHERE enabled = true;

CREATE TABLE IF NOT EXISTS creator_publish_events (
  id UUID PRIMARY KEY,
  mid TEXT NOT NULL
    CHECK (mid ~ '^[1-9][0-9]{0,18}$'),
  event_kind TEXT NOT NULL CHECK (event_kind IN ('video', 'dynamic')),
  external_id TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  title_snapshot TEXT NOT NULL DEFAULT '',
  first_discovered_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'bilibili' CHECK (source = 'bilibili'),
  monitored_target_id UUID REFERENCES monitor_targets (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT creator_publish_events_external_id_chk CHECK (
    (event_kind = 'video' AND external_id ~ '^BV[1-9A-HJ-NP-Za-km-z]{10}$')
    OR (event_kind = 'dynamic' AND external_id ~ '^[1-9][0-9]*$')
  ),
  CONSTRAINT uq_creator_publish_events_identity UNIQUE (event_kind, external_id)
);

CREATE INDEX IF NOT EXISTS creator_publish_events_mid_published
  ON creator_publish_events (mid, published_at ASC);

CREATE INDEX IF NOT EXISTS creator_publish_events_monitored_target
  ON creator_publish_events (monitored_target_id)
  WHERE monitored_target_id IS NOT NULL;

-- Dense collect plan for auto-created new videos only (15m → 30m → normal).
-- Switch times are stored at creation so restarts and re-scheduling do not drift.
CREATE TABLE IF NOT EXISTS video_dense_collect_plans (
  target_id UUID PRIMARY KEY REFERENCES monitor_targets (id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('dense15', 'dense30', 'normal')),
  activated_at TIMESTAMPTZ NOT NULL,
  dense15_until TIMESTAMPTZ NOT NULL,
  dense30_until TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT video_dense_collect_plans_window_chk CHECK (
    dense15_until > activated_at
    AND dense30_until > dense15_until
  ),
  CONSTRAINT video_dense_collect_plans_normal_completed_chk CHECK (
    (phase = 'normal' AND completed_at IS NOT NULL)
    OR (phase <> 'normal' AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS video_dense_collect_plans_active_phase
  ON video_dense_collect_plans (phase)
  WHERE phase <> 'normal';
