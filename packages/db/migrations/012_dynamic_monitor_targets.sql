-- WP-R2-16C: a monitor target may be one already-known dynamic.
-- Does not edit 005. Dynamic ids stay TEXT. This stage only allows a fixed interval.

ALTER TABLE monitor_targets DROP CONSTRAINT IF EXISTS monitor_targets_type_check;
ALTER TABLE monitor_targets
  ADD CONSTRAINT monitor_targets_type_check
  CHECK ("type" IN ('video', 'creator', 'dynamic'));

ALTER TABLE monitor_targets DROP CONSTRAINT IF EXISTS monitor_targets_external_id_chk;
ALTER TABLE monitor_targets
  ADD CONSTRAINT monitor_targets_external_id_chk CHECK (
    ("type" = 'video' AND external_id ~ '^BV[1-9A-HJ-NP-Za-km-z]{10}$')
    OR ("type" = 'creator' AND external_id ~ '^[1-9][0-9]{0,18}$')
    OR ("type" = 'dynamic' AND external_id ~ '^[1-9][0-9]*$')
  );

ALTER TABLE monitor_targets DROP CONSTRAINT IF EXISTS monitor_targets_dynamic_interval_mode_chk;
ALTER TABLE monitor_targets
  ADD CONSTRAINT monitor_targets_dynamic_interval_mode_chk
  CHECK ("type" <> 'dynamic' OR interval_mode = 'fixed');
