-- WP-OC-013: keep amount rationale and source quotes next to the amount.
ALTER TABLE commercial_projects
  ADD COLUMN IF NOT EXISTS amount_rationale TEXT,
  ADD COLUMN IF NOT EXISTS amount_evidence JSONB NOT NULL DEFAULT '[]'::jsonb;
