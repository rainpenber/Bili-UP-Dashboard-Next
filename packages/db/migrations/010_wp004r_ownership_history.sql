-- WP-004R: restore open-item node ownership FKs + node status history

CREATE TABLE IF NOT EXISTS wf_node_status_history (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES commercial_projects (id) ON DELETE CASCADE,
  node_id UUID NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'migration',
  detail JSONB
);

CREATE INDEX IF NOT EXISTS idx_wf_node_status_history_project_node
  ON wf_node_status_history (project_id, node_id, changed_at DESC);

ALTER TABLE open_items DROP CONSTRAINT IF EXISTS fk_open_items_workflow_node;
ALTER TABLE open_items DROP CONSTRAINT IF EXISTS fk_open_items_blocks_node;

ALTER TABLE open_items
  ADD CONSTRAINT fk_open_items_workflow_node
  FOREIGN KEY (project_id, workflow_node_id) REFERENCES wf_nodes (project_id, id) ON DELETE SET NULL;

ALTER TABLE open_items
  ADD CONSTRAINT fk_open_items_blocks_node
  FOREIGN KEY (project_id, blocks_node_id) REFERENCES wf_nodes (project_id, id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS template_undo_stacks (
  template_version_id UUID PRIMARY KEY REFERENCES wf_template_versions (id) ON DELETE CASCADE,
  undo_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  redo_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
