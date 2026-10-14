-- WP-004R: composite ownership for primary block pin (item must belong to same project as node)

CREATE UNIQUE INDEX IF NOT EXISTS uq_open_items_project_id ON open_items (project_id, id);

ALTER TABLE wf_nodes DROP CONSTRAINT IF EXISTS fk_wf_nodes_primary_block_item;

ALTER TABLE wf_nodes
  ADD CONSTRAINT fk_wf_nodes_primary_block_item_project
  FOREIGN KEY (project_id, primary_block_pinned_item_id) REFERENCES open_items (project_id, id) ON DELETE SET NULL;
