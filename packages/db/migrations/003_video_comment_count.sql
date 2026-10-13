-- WP-003: nullable video comment count (historical rows remain NULL)

ALTER TABLE video_metric_samples
  ADD COLUMN IF NOT EXISTS comment_count BIGINT;
