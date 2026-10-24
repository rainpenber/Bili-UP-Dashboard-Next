-- WP-OC-004: AV dynamics duplicate the upload video. Store the archive bvid on
-- the dynamic event so reads can hide it while the original row is retained.

ALTER TABLE creator_publish_events
  ADD COLUMN IF NOT EXISTS related_bvid TEXT;

CREATE INDEX IF NOT EXISTS creator_publish_events_mid_related_bvid
  ON creator_publish_events (mid, related_bvid)
  WHERE related_bvid IS NOT NULL;
