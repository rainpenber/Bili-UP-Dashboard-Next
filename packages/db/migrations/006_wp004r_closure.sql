-- WP-004R closure: ownership, packages, jobs, template drafts, default graph fix

ALTER TABLE wf_template_versions
  ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE wf_template_versions SET is_draft = FALSE WHERE is_draft IS NULL;

ALTER TABLE wf_nodes
  ADD COLUMN IF NOT EXISTS status_before_block TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_workflows_id_project
  ON project_workflows (id, project_id);

ALTER TABLE wf_nodes DROP CONSTRAINT IF EXISTS fk_wf_nodes_wf_project;
ALTER TABLE wf_nodes
  ADD CONSTRAINT fk_wf_nodes_wf_project
  FOREIGN KEY (workflow_id, project_id) REFERENCES project_workflows (id, project_id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS wf_packages (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES project_workflows (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE (workflow_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_nodes_tpl_instance
  ON wf_nodes (workflow_id, template_node_id)
  WHERE template_node_id IS NOT NULL;

UPDATE wf_nodes SET package_id = NULL WHERE package_id IS NOT NULL;

ALTER TABLE wf_nodes DROP CONSTRAINT IF EXISTS fk_wf_nodes_package;
ALTER TABLE wf_nodes DROP CONSTRAINT IF EXISTS fk_wf_nodes_instance_package;
ALTER TABLE wf_nodes
  ADD CONSTRAINT fk_wf_nodes_instance_package
  FOREIGN KEY (workflow_id, package_id) REFERENCES wf_packages (workflow_id, id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS monitor_jobs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES commercial_projects (id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('metadata', 'metrics')),
  status TEXT NOT NULL DEFAULT 'pending',
  due_at TIMESTAMPTZ,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, job_type)
);

ALTER TABLE open_items DROP CONSTRAINT IF EXISTS fk_open_items_workflow_node;
ALTER TABLE open_items DROP CONSTRAINT IF EXISTS fk_open_items_blocks_node;

CREATE OR REPLACE FUNCTION trg_open_items_clear_node_refs()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE open_items SET workflow_node_id = NULL WHERE workflow_node_id = OLD.id;
    UPDATE open_items SET blocks_node_id = NULL WHERE blocks_node_id = OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wf_nodes_clear_open_item_refs ON wf_nodes;
CREATE TRIGGER wf_nodes_clear_open_item_refs
  AFTER DELETE ON wf_nodes
  FOR EACH ROW EXECUTE FUNCTION trg_open_items_clear_node_refs();

-- AI后期需文案与预拍摄汇合
INSERT INTO wf_template_edges (id, template_version_id, from_node_id, to_node_id)
VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee14', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd003', 'dddddddd-dddd-4ddd-8ddd-ddddddddd007'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee15', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd004', 'dddddddd-dddd-4ddd-8ddd-ddddddddd007')
ON CONFLICT DO NOTHING;
