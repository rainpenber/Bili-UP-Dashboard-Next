-- WP-001 import evidence, idempotency, staging

ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS importer_version TEXT;

CREATE TABLE IF NOT EXISTS source_metric_rows (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
  source_file_id BIGINT NOT NULL REFERENCES source_files (id) ON DELETE CASCADE,
  row_index INT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  sampled_at TIMESTAMPTZ,
  raw_time TEXT,
  payload JSONB NOT NULL,
  quality_flags TEXT[] NOT NULL DEFAULT '{}'::text[],
  is_canonical BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (batch_id, source_file_id, row_index)
);

CREATE TABLE IF NOT EXISTS applied_canonical_sources (
  importer_version TEXT NOT NULL,
  file_kind TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  first_applied_batch_id UUID NOT NULL REFERENCES import_batches (id),
  last_applied_batch_id UUID NOT NULL REFERENCES import_batches (id),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (importer_version, file_kind, entity_key, content_sha256)
);

CREATE TABLE IF NOT EXISTS applied_source_provenance (
  id BIGSERIAL PRIMARY KEY,
  importer_version TEXT NOT NULL,
  file_kind TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  source_role TEXT NOT NULL CHECK (source_role IN ('backend', 'frontend')),
  relative_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  first_applied_batch_id UUID NOT NULL REFERENCES import_batches (id),
  UNIQUE (
    importer_version,
    file_kind,
    entity_key,
    content_sha256,
    source_role,
    relative_path
  )
);

CREATE INDEX IF NOT EXISTS idx_source_metric_rows_batch ON source_metric_rows (batch_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches (status);
