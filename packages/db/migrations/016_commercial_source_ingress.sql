-- WP-R2-19A: commercial source identity + snapshot foundation (ingress only; no Hermes migration).
-- Marks declared fixture project IDs as origin_kind=fixture. Does not classify other rows as real/fixture.

ALTER TABLE commercial_projects
  ADD COLUMN IF NOT EXISTS origin_kind TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commercial_projects_origin_kind_check'
  ) THEN
    ALTER TABLE commercial_projects
      ADD CONSTRAINT commercial_projects_origin_kind_check
      CHECK (origin_kind IS NULL OR origin_kind IN ('real', 'fixture', 'manual'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_commercial_projects_origin_kind
  ON commercial_projects (origin_kind);

-- Declared commercial fixture project IDs only (packages/db/src/commercial-fixtures.ts).
UPDATE commercial_projects
SET origin_kind = 'fixture'
WHERE id IN (
  'f0010001-0001-4001-8001-000000000001',
  'f0010001-0001-4001-8001-000000000002',
  'f0010001-0001-4001-8001-000000000003',
  'f0010001-0001-4001-8001-000000000004',
  'f0010001-0001-4001-8001-000000000005',
  'f0010001-0001-4001-8001-000000000006',
  'f0010001-0001-4001-8001-000000000007',
  'f0010001-0001-4001-8001-000000000008',
  'f0010001-0001-4001-8001-000000000009',
  'f0010001-0001-4001-8001-000000000010',
  'f0010001-0001-4001-8001-000000000011',
  'f0010001-0001-4001-8001-000000000012',
  'f0010001-0001-4001-8001-000000000013'
)
AND (origin_kind IS DISTINCT FROM 'fixture');

CREATE TABLE IF NOT EXISTS commercial_project_sources (
  id UUID PRIMARY KEY,
  namespace TEXT NOT NULL,
  source_id TEXT NOT NULL,
  project_id UUID NOT NULL REFERENCES commercial_projects (id) ON DELETE CASCADE,
  origin_kind TEXT NOT NULL CHECK (origin_kind IN ('real', 'fixture', 'manual')),
  source_updated_at TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash TEXT NOT NULL,
  source_status TEXT,
  source_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commercial_project_sources_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT commercial_project_sources_evidence_object CHECK (jsonb_typeof(evidence) = 'object'),
  CONSTRAINT uq_commercial_project_sources_key UNIQUE (namespace, source_id),
  CONSTRAINT uq_commercial_project_sources_project UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS idx_commercial_project_sources_origin
  ON commercial_project_sources (origin_kind);

CREATE INDEX IF NOT EXISTS idx_commercial_project_sources_imported
  ON commercial_project_sources (imported_at DESC);
