-- WP-OC-006: any node may be marked not_applicable.
-- The status whitelist (wf_nodes_status_check) stays untouched; only the
-- is_optional coupling is removed so non-video projects can be closed.
ALTER TABLE IF EXISTS wf_nodes DROP CONSTRAINT IF EXISTS wf_nodes_check;
