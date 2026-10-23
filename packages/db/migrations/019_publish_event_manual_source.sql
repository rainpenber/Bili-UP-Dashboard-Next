-- WP-R2-26A: allow manual publish-event markers for historical content.
-- Dedup key becomes (mid, event_kind, external_id) so different creators may
-- each record the same external id. Rollback: restore source='bilibili' check
-- and UNIQUE (event_kind, external_id) after deleting source='manual' rows.

ALTER TABLE creator_publish_events DROP CONSTRAINT IF EXISTS creator_publish_events_source_check;
ALTER TABLE creator_publish_events
  ADD CONSTRAINT creator_publish_events_source_check
  CHECK (source IN ('bilibili', 'manual'));

ALTER TABLE creator_publish_events DROP CONSTRAINT IF EXISTS uq_creator_publish_events_identity;
ALTER TABLE creator_publish_events
  ADD CONSTRAINT uq_creator_publish_events_identity
  UNIQUE (mid, event_kind, external_id);
