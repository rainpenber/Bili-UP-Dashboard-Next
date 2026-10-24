-- WP-R2-MON-01: video list pin + published-at sort (backward compatible).
-- pinned_at NULL = not pinned; non-NULL = pinned (set to now() on pin).

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
