-- WP-OC-011: project-level open items may wait on a third party.
-- Existing us/client rows stay valid; only the allowed actor set widens.

ALTER TABLE open_items DROP CONSTRAINT IF EXISTS open_items_next_actor_check;
ALTER TABLE open_items
  ADD CONSTRAINT open_items_next_actor_check
  CHECK (next_actor IN ('us', 'client', 'third_party'));
