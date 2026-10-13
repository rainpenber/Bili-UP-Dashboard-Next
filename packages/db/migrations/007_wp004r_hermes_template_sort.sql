-- WP-004R: Hermes results, template constraints, project sort timestamps, monitor job retry

ALTER TABLE commercial_projects
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE commercial_projects
  ADD COLUMN IF NOT EXISTS blocked_since_at TIMESTAMPTZ;

ALTER TABLE hermes_write_proposals
  ADD COLUMN IF NOT EXISTS result_json JSONB;

ALTER TABLE monitor_jobs
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_template_draft_per_slug
  ON wf_template_versions (slug) WHERE is_draft = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_template_default_per_slug
  ON wf_template_versions (slug) WHERE is_default = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_template_node_id_version
  ON wf_template_nodes (id, template_version_id);
