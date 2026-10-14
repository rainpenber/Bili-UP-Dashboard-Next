-- WP-004R: safe open-item ownership FKs + wf_nodes template version anchor

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

ALTER TABLE wf_nodes
  ADD COLUMN IF NOT EXISTS template_version_id UUID REFERENCES wf_template_versions (id);

UPDATE wf_nodes n
SET template_version_id = pw.template_version_id
FROM project_workflows pw
WHERE pw.id = n.workflow_id AND n.template_version_id IS NULL;

ALTER TABLE wf_nodes ALTER COLUMN template_version_id SET NOT NULL;

ALTER TABLE wf_nodes DROP CONSTRAINT IF EXISTS wf_nodes_template_node_id_fkey;

ALTER TABLE wf_nodes
  ADD CONSTRAINT fk_wf_nodes_template_node_version
  FOREIGN KEY (template_version_id, template_node_id) REFERENCES wf_template_nodes (template_version_id, id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION trg_wf_nodes_fill_template_version()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.template_version_id IS NULL THEN
    SELECT template_version_id INTO NEW.template_version_id
    FROM project_workflows WHERE id = NEW.workflow_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wf_nodes_fill_template_version ON wf_nodes;
CREATE TRIGGER wf_nodes_fill_template_version
  BEFORE INSERT ON wf_nodes
  FOR EACH ROW EXECUTE FUNCTION trg_wf_nodes_fill_template_version();

CREATE OR REPLACE FUNCTION trg_wf_nodes_template_version_match()
RETURNS TRIGGER AS $$
DECLARE
  expected UUID;
BEGIN
  IF NEW.template_node_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT template_version_id INTO expected FROM project_workflows WHERE id = NEW.workflow_id;
  IF expected IS NULL OR NEW.template_version_id IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'wf_nodes template_version_id must match project workflow template version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wf_nodes_template_version_match ON wf_nodes;
CREATE TRIGGER wf_nodes_template_version_match
  BEFORE INSERT OR UPDATE OF workflow_id, template_version_id, template_node_id ON wf_nodes
  FOR EACH ROW EXECUTE FUNCTION trg_wf_nodes_template_version_match();
