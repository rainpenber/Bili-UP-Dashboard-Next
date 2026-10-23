-- WP-R2-24A: creator + dynamic list pin (mirror videos.pinned_at).
-- pinned_at NULL = not pinned; non-NULL = pinned (set to now() on pin).
-- Rollback: DROP INDEX IF EXISTS ...; ALTER TABLE ... DROP COLUMN IF EXISTS pinned_at;

ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

ALTER TABLE dynamics
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- Partial indexes for "pinned first" list scans.
CREATE INDEX IF NOT EXISTS creators_pinned_at_partial_idx
  ON creators (pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS dynamics_pinned_at_partial_idx
  ON dynamics (pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

-- Secondary sort helpers (followers via samples; name via uname; likes/comments via samples).
CREATE INDEX IF NOT EXISTS creators_uname_asc_idx
  ON creators (uname ASC NULLS LAST, mid ASC);

CREATE INDEX IF NOT EXISTS dynamics_dynamic_id_asc_idx
  ON dynamics (dynamic_id ASC);
