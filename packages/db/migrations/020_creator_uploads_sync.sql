-- WP-R2-26B: per-creator upload-list sync cache (TTL 6h; metadata + publish events only).
-- Does not create monitor targets. Independent of discovery polling watermarks.

CREATE TABLE IF NOT EXISTS creator_uploads_sync_state (
  mid TEXT PRIMARY KEY
    CHECK (mid ~ '^[1-9][0-9]{0,18}$'),
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  last_video_count INT NOT NULL DEFAULT 0 CHECK (last_video_count >= 0),
  last_events_created INT NOT NULL DEFAULT 0 CHECK (last_events_created >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
