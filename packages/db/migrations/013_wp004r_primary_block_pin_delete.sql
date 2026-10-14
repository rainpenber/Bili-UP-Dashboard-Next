-- WP-004R: primary_block pin — RESTRICT FK + trigger (avoid composite ON DELETE SET NULL clearing project_id)

UPDATE wf_nodes n
SET primary_block_pinned_item_id = NULL, updated_at = now()
WHERE n.primary_block_pinned_item_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM open_items o
    WHERE o.id = n.primary_block_pinned_item_id AND o.project_id = n.project_id
  );

ALTER TABLE wf_nodes DROP CONSTRAINT IF EXISTS fk_wf_nodes_primary_block_item_project;
ALTER TABLE wf_nodes DROP CONSTRAINT IF EXISTS fk_wf_nodes_primary_block_item;

ALTER TABLE wf_nodes
  ADD CONSTRAINT fk_wf_nodes_primary_block_item_project
  FOREIGN KEY (project_id, primary_block_pinned_item_id) REFERENCES open_items (project_id, id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION trg_open_items_clear_primary_block_pin()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE wf_nodes
  SET primary_block_pinned_item_id = NULL, updated_at = now()
  WHERE project_id = OLD.project_id AND primary_block_pinned_item_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS open_items_clear_primary_block_pin ON open_items;
CREATE TRIGGER open_items_clear_primary_block_pin
  BEFORE DELETE ON open_items
  FOR EACH ROW EXECUTE FUNCTION trg_open_items_clear_primary_block_pin();
