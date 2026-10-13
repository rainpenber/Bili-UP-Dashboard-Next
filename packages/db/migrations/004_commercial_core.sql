-- WP-004R: commercial project core (replaces legacy WP-004 workflow model)

DROP TABLE IF EXISTS hermes_change_proposals CASCADE;
DROP TABLE IF EXISTS open_items CASCADE;
DROP TABLE IF EXISTS workflow_node_status_history CASCADE;
DROP TABLE IF EXISTS workflow_node_dependencies CASCADE;
DROP TABLE IF EXISTS workflow_nodes CASCADE;
DROP TABLE IF EXISTS project_workflows CASCADE;
DROP TABLE IF EXISTS workflow_template_node_dependencies CASCADE;
DROP TABLE IF EXISTS workflow_template_nodes CASCADE;
DROP TABLE IF EXISTS workflow_templates CASCADE;
DROP TABLE IF EXISTS projects CASCADE;

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
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);

CREATE TABLE wf_template_packages (
  id UUID PRIMARY KEY,
  template_version_id UUID NOT NULL REFERENCES wf_template_versions (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE wf_template_nodes (
  id UUID PRIMARY KEY,
  template_version_id UUID NOT NULL REFERENCES wf_template_versions (id) ON DELETE CASCADE,
  package_id UUID REFERENCES wf_template_packages (id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  is_optional BOOLEAN NOT NULL DEFAULT FALSE,
  pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  pos_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE (template_version_id, slug)
);

CREATE TABLE wf_template_edges (
  id UUID PRIMARY KEY,
  template_version_id UUID NOT NULL REFERENCES wf_template_versions (id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL REFERENCES wf_template_nodes (id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES wf_template_nodes (id) ON DELETE CASCADE,
  UNIQUE (template_version_id, from_node_id, to_node_id),
  CHECK (from_node_id <> to_node_id)
);

CREATE TABLE project_workflows (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL UNIQUE REFERENCES commercial_projects (id) ON DELETE CASCADE,
  template_version_id UUID NOT NULL REFERENCES wf_template_versions (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wf_nodes (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES project_workflows (id) ON DELETE CASCADE,
  template_node_id UUID REFERENCES wf_template_nodes (id) ON DELETE SET NULL,
  package_id UUID,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_reached' CHECK (
    status IN ('not_reached', 'in_progress', 'completed', 'blocked', 'not_applicable')
  ),
  is_optional BOOLEAN NOT NULL DEFAULT FALSE,
  planned_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  pos_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  blocking_open_item_id UUID,
  source TEXT NOT NULL DEFAULT 'template' CHECK (source IN ('template', 'web', 'hermes', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wf_nodes_workflow ON wf_nodes (workflow_id);
CREATE INDEX idx_wf_nodes_status ON wf_nodes (status);

CREATE TABLE wf_edges (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES project_workflows (id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL REFERENCES wf_nodes (id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES wf_nodes (id) ON DELETE CASCADE,
  UNIQUE (workflow_id, from_node_id, to_node_id),
  CHECK (from_node_id <> to_node_id)
);

CREATE TABLE open_items (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES commercial_projects (id) ON DELETE CASCADE,
  workflow_node_id UUID REFERENCES wf_nodes (id) ON DELETE SET NULL,
  blocks_node_id UUID REFERENCES wf_nodes (id) ON DELETE SET NULL,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_open_items_project ON open_items (project_id);
CREATE INDEX idx_open_items_lifecycle ON open_items (lifecycle);
CREATE INDEX idx_open_items_impact ON open_items (impact);

ALTER TABLE wf_nodes
  ADD CONSTRAINT fk_wf_nodes_blocking_item
  FOREIGN KEY (blocking_open_item_id) REFERENCES open_items (id) ON DELETE SET NULL;

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
  metadata_task_status TEXT NOT NULL DEFAULT 'pending',
  metadata_title TEXT,
  metadata_cover_url TEXT,
  metadata_cid TEXT,
  metrics_fetch_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE workflow_audit_log (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES commercial_projects (id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_audit_project ON workflow_audit_log (project_id, created_at DESC);

-- Default template v1 (DAG)
INSERT INTO wf_template_versions (id, slug, name, version, is_default)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'default_sponsorship', '默认商单流程', 1, TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO wf_template_packages (id, template_version_id, name, sort_order)
VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc01', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '制作并行包', 40)
ON CONFLICT DO NOTHING;

INSERT INTO wf_template_nodes (id, template_version_id, package_id, slug, name, is_optional, pos_x, pos_y)
VALUES
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 'inquiry', '询单', FALSE, 0, 0),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 'outline', '大纲', FALSE, 0, 120),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 'copy', '文案', FALSE, -120, 240),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 'pre_shoot', '预拍摄', FALSE, 120, 240),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccc01', 'a_roll', 'A-roll', FALSE, -160, 360),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccc01', 'b_roll', 'B-roll', FALSE, 0, 360),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd007', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccc01', 'ai_post', 'AI后期', FALSE, 160, 360),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd008', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 'review', '审核', FALSE, 0, 480),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd009', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 'publish', '发布', FALSE, 0, 600),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd010', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 'settlement', '结算', FALSE, -200, 720),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd011', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 'distribution', '全平台分发', FALSE, 0, 720),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd012', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 'data_maint', '数据维护', FALSE, 200, 720),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddd013', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 'other', '其他', TRUE, 400, 720)
ON CONFLICT DO NOTHING;

INSERT INTO wf_template_edges (id, template_version_id, from_node_id, to_node_id)
VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd001', 'dddddddd-dddd-4ddd-8ddd-ddddddddd002'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd002', 'dddddddd-dddd-4ddd-8ddd-ddddddddd003'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd002', 'dddddddd-dddd-4ddd-8ddd-ddddddddd004'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd003', 'dddddddd-dddd-4ddd-8ddd-ddddddddd005'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd004', 'dddddddd-dddd-4ddd-8ddd-ddddddddd006'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee06', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd005', 'dddddddd-dddd-4ddd-8ddd-ddddddddd008'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee07', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd006', 'dddddddd-dddd-4ddd-8ddd-ddddddddd008'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee08', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd007', 'dddddddd-dddd-4ddd-8ddd-ddddddddd008'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee09', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd008', 'dddddddd-dddd-4ddd-8ddd-ddddddddd009'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd009', 'dddddddd-dddd-4ddd-8ddd-ddddddddd010'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd009', 'dddddddd-dddd-4ddd-8ddd-ddddddddd011'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee12', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd009', 'dddddddd-dddd-4ddd-8ddd-ddddddddd012'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee13', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-ddddddddd009', 'dddddddd-dddd-4ddd-8ddd-ddddddddd013')
ON CONFLICT DO NOTHING;
