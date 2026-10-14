-- WP-004R2-A: commercial domain (clean rebuild — no legacy WP-004 upgrade path)

CREATE TABLE commercial_projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  net_amount NUMERIC(14, 2),
  rebate_amount NUMERIC(14, 2),
  overall_stage TEXT NOT NULL DEFAULT 'pre_publish' CHECK (
    overall_stage IN ('pre_publish', 'published_winding_down', 'closed', 'archived')
  ),
  user_deadline_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  business_closed_at TIMESTAMPTZ,
  stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_since_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_commercial_projects_stage ON commercial_projects (overall_stage);
CREATE INDEX idx_commercial_projects_archived ON commercial_projects (archived_at);

CREATE TABLE wf_template_versions (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  version INT NOT NULL,
  is_draft BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  UNIQUE (slug, version),
  CHECK (
    (is_draft = TRUE AND published_at IS NULL)
    OR (is_draft = FALSE AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_wf_template_draft_per_slug ON wf_template_versions (slug) WHERE is_draft = TRUE;

CREATE UNIQUE INDEX uq_wf_template_default_per_slug ON wf_template_versions (slug) WHERE is_default = TRUE;

CREATE TABLE wf_template_packages (
  id UUID PRIMARY KEY,
  template_version_id UUID NOT NULL REFERENCES wf_template_versions (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX uq_wf_template_packages_version ON wf_template_packages (template_version_id, id);

CREATE TABLE wf_template_nodes (
  id UUID PRIMARY KEY,
  template_version_id UUID NOT NULL REFERENCES wf_template_versions (id) ON DELETE CASCADE,
  package_id UUID,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'pre_publish' CHECK (
    phase IN ('pre_publish', 'post_publish_required', 'post_publish_optional')
  ),
  is_optional BOOLEAN NOT NULL DEFAULT FALSE,
  pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  pos_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE (template_version_id, slug)
);

CREATE UNIQUE INDEX uq_wf_template_nodes_version ON wf_template_nodes (template_version_id, id);

CREATE UNIQUE INDEX uq_wf_template_node_id_version ON wf_template_nodes (id, template_version_id);

ALTER TABLE wf_template_nodes
  ADD CONSTRAINT fk_wf_template_nodes_package
  FOREIGN KEY (template_version_id, package_id) REFERENCES wf_template_packages (template_version_id, id) ON DELETE SET NULL;

CREATE TABLE wf_template_edges (
  id UUID PRIMARY KEY,
  template_version_id UUID NOT NULL REFERENCES wf_template_versions (id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL,
  to_node_id UUID NOT NULL,
  UNIQUE (template_version_id, from_node_id, to_node_id),
  CHECK (from_node_id <> to_node_id)
);

ALTER TABLE wf_template_edges
  ADD CONSTRAINT fk_wf_template_edges_from
  FOREIGN KEY (template_version_id, from_node_id) REFERENCES wf_template_nodes (template_version_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_wf_template_edges_to
  FOREIGN KEY (template_version_id, to_node_id) REFERENCES wf_template_nodes (template_version_id, id) ON DELETE CASCADE;

CREATE TABLE project_workflows (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL UNIQUE REFERENCES commercial_projects (id) ON DELETE CASCADE,
  template_version_id UUID NOT NULL REFERENCES wf_template_versions (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_project_workflows_id_project ON project_workflows (id, project_id);

CREATE TABLE wf_packages (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES project_workflows (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE (workflow_id, id)
);

CREATE TABLE wf_nodes (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES project_workflows (id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES commercial_projects (id) ON DELETE CASCADE,
  template_version_id UUID NOT NULL REFERENCES wf_template_versions (id),
  template_node_id UUID,
  package_id UUID,
  name TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'pre_publish' CHECK (
    phase IN ('pre_publish', 'post_publish_required', 'post_publish_optional')
  ),
  status TEXT NOT NULL DEFAULT 'not_reached' CHECK (
    status IN ('not_reached', 'in_progress', 'completed', 'blocked', 'not_applicable')
  ),
  is_optional BOOLEAN NOT NULL DEFAULT FALSE,
  planned_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status_before_block TEXT,
  pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  pos_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  primary_block_pinned_item_id UUID,
  source TEXT NOT NULL DEFAULT 'template' CHECK (source IN ('template', 'web', 'hermes', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'not_applicable' OR is_optional = TRUE)
);

CREATE UNIQUE INDEX uq_wf_nodes_workflow_id ON wf_nodes (workflow_id, id);
CREATE UNIQUE INDEX uq_wf_nodes_project_id ON wf_nodes (project_id, id);

CREATE UNIQUE INDEX uq_wf_nodes_tpl_instance ON wf_nodes (workflow_id, template_node_id)
WHERE template_node_id IS NOT NULL;

CREATE INDEX idx_wf_nodes_workflow ON wf_nodes (workflow_id);
CREATE INDEX idx_wf_nodes_status ON wf_nodes (status);

ALTER TABLE wf_nodes
  ADD CONSTRAINT fk_wf_nodes_wf_project
  FOREIGN KEY (workflow_id, project_id) REFERENCES project_workflows (id, project_id) ON DELETE CASCADE;

ALTER TABLE wf_nodes
  ADD CONSTRAINT fk_wf_nodes_template_node_version
  FOREIGN KEY (template_version_id, template_node_id) REFERENCES wf_template_nodes (template_version_id, id) ON DELETE RESTRICT;

ALTER TABLE wf_nodes
  ADD CONSTRAINT fk_wf_nodes_instance_package
  FOREIGN KEY (workflow_id, package_id) REFERENCES wf_packages (workflow_id, id) ON DELETE SET NULL;

CREATE TABLE wf_edges (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES project_workflows (id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL,
  to_node_id UUID NOT NULL,
  UNIQUE (workflow_id, from_node_id, to_node_id),
  CHECK (from_node_id <> to_node_id)
);

ALTER TABLE wf_edges
  ADD CONSTRAINT fk_wf_edges_from
  FOREIGN KEY (workflow_id, from_node_id) REFERENCES wf_nodes (workflow_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_wf_edges_to
  FOREIGN KEY (workflow_id, to_node_id) REFERENCES wf_nodes (workflow_id, id) ON DELETE CASCADE;

CREATE TABLE open_items (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES commercial_projects (id) ON DELETE CASCADE,
  workflow_node_id UUID,
  blocks_node_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  close_criteria TEXT,
  next_action TEXT,
  next_actor TEXT NOT NULL DEFAULT 'us' CHECK (next_actor IN ('us', 'client')),
  lifecycle TEXT NOT NULL DEFAULT 'open' CHECK (lifecycle IN ('open', 'closed', 'cancelled')),
  impact TEXT NOT NULL DEFAULT 'normal' CHECK (impact IN ('normal', 'blocking')),
  planned_at TIMESTAMPTZ,
  source_evidence JSONB,
  confidence REAL,
  close_conclusion TEXT,
  cancel_reason TEXT,
  sort_rank INT NOT NULL DEFAULT 0,
  blocks_required_for_close BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  CHECK (
    lifecycle <> 'cancelled'
    OR (cancel_reason IS NOT NULL AND btrim(cancel_reason) <> '')
  )
);

CREATE UNIQUE INDEX uq_open_items_project_id ON open_items (project_id, id);

CREATE INDEX idx_open_items_project ON open_items (project_id);
CREATE INDEX idx_open_items_lifecycle ON open_items (lifecycle);
CREATE INDEX idx_open_items_impact ON open_items (impact);

ALTER TABLE open_items
  ADD CONSTRAINT fk_open_items_workflow_node
  FOREIGN KEY (project_id, workflow_node_id) REFERENCES wf_nodes (project_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_open_items_blocks_node
  FOREIGN KEY (project_id, blocks_node_id) REFERENCES wf_nodes (project_id, id) ON DELETE RESTRICT;

ALTER TABLE wf_nodes
  ADD CONSTRAINT fk_wf_nodes_primary_block_item_project
  FOREIGN KEY (project_id, primary_block_pinned_item_id) REFERENCES open_items (project_id, id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE project_publish_records (
  project_id UUID PRIMARY KEY REFERENCES commercial_projects (id) ON DELETE CASCADE,
  bvid TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  internal_stage_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  publish_source TEXT NOT NULL DEFAULT 'web' CHECK (publish_source IN ('web', 'hermes', 'manual')),
  forced_complete_audit JSONB NOT NULL DEFAULT '[]',
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_monitor_contracts (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL UNIQUE REFERENCES commercial_projects (id) ON DELETE CASCADE,
  bvid TEXT NOT NULL,
  monitor_video_key TEXT,
  linked_bvid TEXT REFERENCES videos (bvid) ON DELETE SET NULL,
  metadata_task_status TEXT NOT NULL DEFAULT 'pending',
  metadata_title TEXT,
  metadata_cover_url TEXT,
  metadata_cid TEXT,
  metadata_fetched_at TIMESTAMPTZ,
  metrics_fetch_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE monitor_jobs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES commercial_projects (id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('metadata', 'metrics')),
  status TEXT NOT NULL DEFAULT 'pending',
  due_at TIMESTAMPTZ,
  result_json JSONB,
  last_error TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, job_type)
);

CREATE TABLE hermes_write_proposals (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES commercial_projects (id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  payload JSONB NOT NULL,
  source_evidence JSONB,
  confidence REAL NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE domain_audit_events (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID REFERENCES commercial_projects (id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_domain_audit_events_project ON domain_audit_events (project_id, created_at DESC);

-- Template version immutability (published versions and their children)
CREATE OR REPLACE FUNCTION assert_wf_template_version_is_draft(p_version_id UUID)
RETURNS VOID AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM wf_template_versions WHERE id = p_version_id AND is_draft = FALSE
  ) THEN
    RAISE EXCEPTION 'template version % is published and immutable', p_version_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_wf_template_versions_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_draft = FALSE THEN
      RAISE EXCEPTION 'cannot delete published template version %', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_draft = FALSE THEN
      RAISE EXCEPTION 'published template version % is immutable', OLD.id;
    END IF;
    IF OLD.is_draft = TRUE AND NEW.is_draft = FALSE THEN
      IF NEW.published_at IS NULL THEN
        NEW.published_at := now();
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wf_template_versions_immutable
  BEFORE UPDATE OR DELETE ON wf_template_versions
  FOR EACH ROW EXECUTE FUNCTION trg_wf_template_versions_immutable();

CREATE OR REPLACE FUNCTION trg_wf_template_child_immutable()
RETURNS TRIGGER AS $$
DECLARE
  vid UUID;
BEGIN
  vid := COALESCE(NEW.template_version_id, OLD.template_version_id);
  PERFORM assert_wf_template_version_is_draft(vid);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wf_template_packages_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON wf_template_packages
  FOR EACH ROW EXECUTE FUNCTION trg_wf_template_child_immutable();

CREATE TRIGGER wf_template_nodes_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON wf_template_nodes
  FOR EACH ROW EXECUTE FUNCTION trg_wf_template_child_immutable();

CREATE TRIGGER wf_template_edges_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON wf_template_edges
  FOR EACH ROW EXECUTE FUNCTION trg_wf_template_child_immutable();

-- Instance workflow: template_version_id must match project_workflows.template_version_id
CREATE OR REPLACE FUNCTION trg_wf_nodes_template_version_match()
RETURNS TRIGGER AS $$
DECLARE
  expected UUID;
BEGIN
  SELECT template_version_id INTO expected FROM project_workflows WHERE id = NEW.workflow_id;
  IF expected IS NULL THEN
    RAISE EXCEPTION 'workflow % not found', NEW.workflow_id;
  END IF;
  IF NEW.template_version_id IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'wf_nodes template_version_id must match project workflow template version';
  END IF;
  IF NEW.template_node_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM wf_template_nodes tn
      WHERE tn.id = NEW.template_node_id AND tn.template_version_id = NEW.template_version_id
    ) THEN
      RAISE EXCEPTION 'template_node_id must belong to the same template_version_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wf_nodes_template_version_match
  BEFORE INSERT OR UPDATE OF workflow_id, template_version_id, template_node_id ON wf_nodes
  FOR EACH ROW EXECUTE FUNCTION trg_wf_nodes_template_version_match();

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

CREATE TRIGGER wf_nodes_fill_template_version
  BEFORE INSERT ON wf_nodes
  FOR EACH ROW EXECUTE FUNCTION trg_wf_nodes_fill_template_version();

-- DAG: reject cycles (workflow instances)
CREATE OR REPLACE FUNCTION trg_wf_edges_no_cycle()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE reach AS (
      SELECT NEW.to_node_id AS node_id
      UNION
      SELECT e.to_node_id
      FROM wf_edges e
      INNER JOIN reach r ON e.from_node_id = r.node_id
      WHERE e.workflow_id = NEW.workflow_id
        AND (TG_OP = 'INSERT' OR e.id IS DISTINCT FROM OLD.id)
    )
    SELECT 1 FROM reach WHERE node_id = NEW.from_node_id
  ) THEN
    RAISE EXCEPTION 'workflow edge would create a cycle in workflow %', NEW.workflow_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wf_edges_no_cycle
  BEFORE INSERT OR UPDATE OF from_node_id, to_node_id ON wf_edges
  FOR EACH ROW EXECUTE FUNCTION trg_wf_edges_no_cycle();

-- DAG: reject cycles (template graphs)
CREATE OR REPLACE FUNCTION trg_wf_template_edges_no_cycle()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE reach AS (
      SELECT NEW.to_node_id AS node_id
      UNION
      SELECT e.to_node_id
      FROM wf_template_edges e
      INNER JOIN reach r ON e.from_node_id = r.node_id
      WHERE e.template_version_id = NEW.template_version_id
        AND (TG_OP = 'INSERT' OR e.id IS DISTINCT FROM OLD.id)
    )
    SELECT 1 FROM reach WHERE node_id = NEW.from_node_id
  ) THEN
    RAISE EXCEPTION 'template edge would create a cycle in version %', NEW.template_version_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wf_template_edges_no_cycle
  BEFORE INSERT OR UPDATE OF from_node_id, to_node_id ON wf_template_edges
  FOR EACH ROW EXECUTE FUNCTION trg_wf_template_edges_no_cycle();

-- Clear nullable node refs before node delete (ownership FKs use RESTRICT)
CREATE OR REPLACE FUNCTION trg_wf_nodes_before_delete_clear_refs()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE wf_nodes
  SET primary_block_pinned_item_id = NULL, updated_at = now()
  WHERE project_id = OLD.project_id
    AND primary_block_pinned_item_id IN (
      SELECT o.id
      FROM open_items o
      WHERE o.project_id = OLD.project_id
        AND (o.workflow_node_id = OLD.id OR o.blocks_node_id = OLD.id)
    );
  UPDATE open_items
  SET workflow_node_id = NULL, blocks_node_id = NULL, updated_at = now()
  WHERE project_id = OLD.project_id
    AND (workflow_node_id = OLD.id OR blocks_node_id = OLD.id);
  UPDATE wf_nodes
  SET primary_block_pinned_item_id = NULL, updated_at = now()
  WHERE id = OLD.id AND primary_block_pinned_item_id IS NOT NULL;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wf_nodes_before_delete_clear_refs
  BEFORE DELETE ON wf_nodes
  FOR EACH ROW EXECUTE FUNCTION trg_wf_nodes_before_delete_clear_refs();

CREATE OR REPLACE FUNCTION trg_open_items_clear_primary_block_pin()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE wf_nodes
  SET primary_block_pinned_item_id = NULL, updated_at = now()
  WHERE project_id = OLD.project_id AND primary_block_pinned_item_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER open_items_clear_primary_block_pin
  BEFORE DELETE ON open_items
  FOR EACH ROW EXECUTE FUNCTION trg_open_items_clear_primary_block_pin();

-- Default sponsorship template (seed as draft, publish after children — triggers enforce immutability)
INSERT INTO wf_template_versions (id, slug, name, version, is_draft, is_default, published_at)
VALUES (
  'ffff1111-1111-4111-8111-111111111111',
  'default_sponsorship',
  '默认商单流程',
  1,
  TRUE,
  TRUE,
  NULL
)
ON CONFLICT (slug, version) DO NOTHING;

INSERT INTO wf_template_packages (id, template_version_id, name, sort_order)
VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc01', 'ffff1111-1111-4111-8111-111111111111', '制作并行包', 40)
ON CONFLICT DO NOTHING;

INSERT INTO wf_template_nodes (
  id, template_version_id, package_id, slug, name, phase, is_optional, pos_x, pos_y
)
VALUES
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd001',
    'ffff1111-1111-4111-8111-111111111111',
    NULL,
    'inquiry',
    '询单',
    'pre_publish',
    FALSE,
    0,
    0
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd002',
    'ffff1111-1111-4111-8111-111111111111',
    NULL,
    'outline',
    '大纲',
    'pre_publish',
    FALSE,
    0,
    120
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd003',
    'ffff1111-1111-4111-8111-111111111111',
    NULL,
    'copy',
    '文案',
    'pre_publish',
    FALSE,
    -120,
    240
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd004',
    'ffff1111-1111-4111-8111-111111111111',
    NULL,
    'pre_shoot',
    '预拍摄',
    'pre_publish',
    FALSE,
    120,
    240
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd005',
    'ffff1111-1111-4111-8111-111111111111',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
    'a_roll',
    'A-roll',
    'pre_publish',
    FALSE,
    -160,
    360
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd006',
    'ffff1111-1111-4111-8111-111111111111',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
    'b_roll',
    'B-roll',
    'pre_publish',
    FALSE,
    0,
    360
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd007',
    'ffff1111-1111-4111-8111-111111111111',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
    'ai_post',
    'AI后期',
    'pre_publish',
    FALSE,
    160,
    360
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd008',
    'ffff1111-1111-4111-8111-111111111111',
    NULL,
    'review',
    '审核',
    'pre_publish',
    FALSE,
    0,
    480
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd009',
    'ffff1111-1111-4111-8111-111111111111',
    NULL,
    'publish',
    '发布',
    'pre_publish',
    FALSE,
    0,
    600
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd010',
    'ffff1111-1111-4111-8111-111111111111',
    NULL,
    'settlement',
    '结算',
    'post_publish_required',
    FALSE,
    -200,
    720
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd011',
    'ffff1111-1111-4111-8111-111111111111',
    NULL,
    'distribution',
    '全平台分发',
    'post_publish_required',
    FALSE,
    0,
    720
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd012',
    'ffff1111-1111-4111-8111-111111111111',
    NULL,
    'data_maint',
    '数据维护',
    'post_publish_required',
    FALSE,
    200,
    720
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd013',
    'ffff1111-1111-4111-8111-111111111111',
    NULL,
    'other',
    '其他',
    'post_publish_optional',
    TRUE,
    400,
    720
  )
ON CONFLICT (template_version_id, slug) DO NOTHING;

INSERT INTO wf_template_edges (id, template_version_id, from_node_id, to_node_id)
VALUES
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd001',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd002'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd002',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd003'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd002',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd004'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd003',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd005'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd004',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd006'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee06',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd005',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd008'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee07',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd006',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd008'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee08',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd007',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd008'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee09',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd008',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd009'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd009',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd010'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd009',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd011'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee12',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd009',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd012'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee13',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd009',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd013'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee14',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd003',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd007'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee15',
    'ffff1111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd004',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd007'
  )
ON CONFLICT (template_version_id, from_node_id, to_node_id) DO NOTHING;

UPDATE wf_template_versions
SET is_draft = FALSE, published_at = COALESCE(published_at, now())
WHERE id = 'ffff1111-1111-4111-8111-111111111111' AND is_draft = TRUE;
