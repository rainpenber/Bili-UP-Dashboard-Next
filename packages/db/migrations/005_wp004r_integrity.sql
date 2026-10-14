-- WP-004R: phases, ownership FKs, monitor link, Hermes idempotency

ALTER TABLE wf_template_nodes
  ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'pre_publish' CHECK (
    phase IN ('pre_publish', 'post_publish_required', 'post_publish_optional')
  );

UPDATE wf_template_nodes SET phase = 'post_publish_required'
WHERE slug IN ('settlement', 'distribution', 'data_maint');
UPDATE wf_template_nodes SET phase = 'post_publish_optional' WHERE slug = 'other';

ALTER TABLE wf_nodes
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES commercial_projects (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'pre_publish' CHECK (
    phase IN ('pre_publish', 'post_publish_required', 'post_publish_optional')
  ),
  ADD COLUMN IF NOT EXISTS primary_block_pinned_item_id UUID;

UPDATE wf_nodes n
SET project_id = pw.project_id
FROM project_workflows pw
WHERE pw.id = n.workflow_id AND n.project_id IS NULL;

UPDATE wf_nodes n
SET phase = t.phase
FROM wf_template_nodes t
WHERE t.id = n.template_node_id;

ALTER TABLE wf_nodes ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE wf_nodes DROP CONSTRAINT IF EXISTS fk_wf_nodes_blocking_item;
ALTER TABLE wf_nodes DROP COLUMN IF EXISTS blocking_open_item_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_nodes_workflow_id ON wf_nodes (workflow_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_nodes_project_id ON wf_nodes (project_id, id);

ALTER TABLE wf_nodes DROP CONSTRAINT IF EXISTS wf_edges_workflow_id_from_node_id_to_node_id_key;

ALTER TABLE wf_edges
  ADD CONSTRAINT fk_wf_edges_from
  FOREIGN KEY (workflow_id, from_node_id) REFERENCES wf_nodes (workflow_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_wf_edges_to
  FOREIGN KEY (workflow_id, to_node_id) REFERENCES wf_nodes (workflow_id, id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_template_packages_version
  ON wf_template_packages (template_version_id, id);

ALTER TABLE wf_template_nodes
  ADD CONSTRAINT fk_wf_template_nodes_package
  FOREIGN KEY (template_version_id, package_id) REFERENCES wf_template_packages (template_version_id, id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_template_nodes_version
  ON wf_template_nodes (template_version_id, id);

ALTER TABLE wf_template_edges
  ADD CONSTRAINT fk_wf_template_edges_from
  FOREIGN KEY (template_version_id, from_node_id) REFERENCES wf_template_nodes (template_version_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_wf_template_edges_to
  FOREIGN KEY (template_version_id, to_node_id) REFERENCES wf_template_nodes (template_version_id, id) ON DELETE CASCADE;

ALTER TABLE open_items
  ADD CONSTRAINT fk_open_items_workflow_node
  FOREIGN KEY (project_id, workflow_node_id) REFERENCES wf_nodes (project_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_open_items_blocks_node
  FOREIGN KEY (project_id, blocks_node_id) REFERENCES wf_nodes (project_id, id) ON DELETE SET NULL;

ALTER TABLE wf_nodes
  ADD CONSTRAINT fk_wf_nodes_primary_block_item
  FOREIGN KEY (primary_block_pinned_item_id) REFERENCES open_items (id) ON DELETE SET NULL;

ALTER TABLE open_items
  ADD COLUMN IF NOT EXISTS sort_rank INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocks_required_for_close BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE project_monitor_contracts
  ADD COLUMN IF NOT EXISTS metadata_cid TEXT,
  ADD COLUMN IF NOT EXISTS metadata_fetched_at TIMESTAMPTZ;

ALTER TABLE project_monitor_contracts
  DROP CONSTRAINT IF EXISTS project_monitor_contracts_monitor_video_key_fkey;

-- Link to canonical monitoring videos when present
ALTER TABLE project_monitor_contracts
  ADD COLUMN IF NOT EXISTS linked_bvid TEXT REFERENCES videos (bvid) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS hermes_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  project_id UUID,
  payload_hash TEXT NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_undo_stacks (
  project_id UUID PRIMARY KEY REFERENCES commercial_projects (id) ON DELETE CASCADE,
  undo_json JSONB NOT NULL DEFAULT '[]',
  redo_json JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
