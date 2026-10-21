-- WP-R2-17R1: planned start time for video monitor targets.
-- start_at is the user-provided intent. next_run_at remains the scheduler cursor.
-- Non-video types must keep start_at NULL (enforced here and in the write path).

ALTER TABLE monitor_targets
  ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;

ALTER TABLE monitor_targets DROP CONSTRAINT IF EXISTS monitor_targets_start_at_video_chk;
ALTER TABLE monitor_targets
  ADD CONSTRAINT monitor_targets_start_at_video_chk
  CHECK (start_at IS NULL OR "type" = 'video');

CREATE INDEX IF NOT EXISTS monitor_targets_start_at
  ON monitor_targets (start_at)
  WHERE deleted_at IS NULL AND enabled = true AND start_at IS NOT NULL;
