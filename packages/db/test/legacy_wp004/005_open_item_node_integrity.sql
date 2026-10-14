-- Ensure open_items.workflow_node_id belongs to the same project

CREATE OR REPLACE FUNCTION enforce_open_item_node_project_match()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.workflow_node_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM workflow_nodes wn
      INNER JOIN project_workflows pw ON pw.id = wn.project_workflow_id
      WHERE wn.id = NEW.workflow_node_id AND pw.project_id = NEW.project_id
    ) THEN
      RAISE EXCEPTION 'workflow_node_id must belong to the same project';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_open_items_node_project ON open_items;
CREATE TRIGGER trg_open_items_node_project
  BEFORE INSERT OR UPDATE OF workflow_node_id, project_id ON open_items
  FOR EACH ROW
  EXECUTE FUNCTION enforce_open_item_node_project_match();
