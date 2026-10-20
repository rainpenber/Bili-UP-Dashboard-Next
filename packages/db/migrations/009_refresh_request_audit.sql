-- WP-R2-08: metadata refresh reuses collector_requests.run_id for backfill_runs.id.
-- Collector jobs still write their own collector_runs ids. Dropping the foreign key
-- does not change how those rows are inserted; it only allows the refresh audit to
-- point at a backfill batch. Idempotent.

DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT c.conname INTO fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'collector_requests'
    AND c.contype = 'f'
    AND pg_get_constraintdef(c.oid) ILIKE '%collector_runs%';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE collector_requests DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;
