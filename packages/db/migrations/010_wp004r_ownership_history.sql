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
  FOREIGN KEY (project_id, workflow_node_id) REFERENCES wf_nodes (project_id, id) ON DELETE RESTRICT;

ALTER TABLE open_items
  ADD CONSTRAINT fk_open_items_blocks_node
  FOREIGN KEY (project_id, blocks_node_id) REFERENCES wf_nodes (project_id, id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION trg_wf_nodes_before_delete_clear_refs()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE wf_nodes SET primary_block_pinned_item_id = NULL
  WHERE project_id = OLD.project_id
    AND primary_block_pinned_item_id IN (
      SELECT id FROM open_items
      WHERE project_id = OLD.project_id
        AND (workflow_node_id = OLD.id OR blocks_node_id = OLD.id)
    );
  UPDATE open_items
  SET workflow_node_id = NULL, blocks_node_id = NULL, updated_at = now()
  WHERE project_id = OLD.project_id
    AND (workflow_node_id = OLD.id OR blocks_node_id = OLD.id);
  UPDATE wf_nodes SET primary_block_pinned_item_id = NULL
  WHERE id = OLD.id AND primary_block_pinned_item_id IS NOT NULL;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wf_nodes_before_delete_clear_refs ON wf_nodes;
CREATE TRIGGER wf_nodes_before_delete_clear_refs
  BEFORE DELETE ON wf_nodes
  FOR EACH ROW EXECUTE FUNCTION trg_wf_nodes_before_delete_clear_refs();

CREATE TABLE IF NOT EXISTS template_undo_stacks (
  template_version_id UUID PRIMARY KEY REFERENCES wf_template_versions (id) ON DELETE CASCADE,
  undo_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  redo_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
