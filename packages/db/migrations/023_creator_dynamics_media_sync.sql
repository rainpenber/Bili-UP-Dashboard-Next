-- WP-R2-27A: dynamics sync TTL cache + media backfill TTL cache.
-- Dynamics sync writes creator_publish_events only (no monitor targets).
-- Media backfill fills creators.face_url + videos.cover_url (no disk assets).

CREATE TABLE IF NOT EXISTS creator_dynamics_sync_state (
  mid TEXT PRIMARY KEY
    CHECK (mid ~ '^[1-9][0-9]{0,18}$'),
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  last_dynamic_count INT NOT NULL DEFAULT 0 CHECK (last_dynamic_count >= 0),
  last_events_created INT NOT NULL DEFAULT 0 CHECK (last_events_created >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creator_media_backfill_state (
  mid TEXT PRIMARY KEY
    CHECK (mid ~ '^[1-9][0-9]{0,18}$'),
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  last_face_updated BOOLEAN NOT NULL DEFAULT false,
  last_covers_updated INT NOT NULL DEFAULT 0 CHECK (last_covers_updated >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
