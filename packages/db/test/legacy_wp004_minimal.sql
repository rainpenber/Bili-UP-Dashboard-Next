-- Minimal legacy WP-004 schema + one project for migration upgrade tests

CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS workflow_template_nodes (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES workflow_templates (id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (template_id, slug)
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  derived_stage TEXT NOT NULL DEFAULT 'business_init',
  planned_publish_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_workflows (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL UNIQUE REFERENCES projects (id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES workflow_templates (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_nodes (
  id UUID PRIMARY KEY,
  project_workflow_id UUID NOT NULL REFERENCES project_workflows (id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'locked',
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (project_workflow_id, slug)
);

CREATE TABLE IF NOT EXISTS workflow_node_dependencies (
  id BIGSERIAL PRIMARY KEY,
  node_id UUID NOT NULL REFERENCES workflow_nodes (id) ON DELETE CASCADE,
  depends_on_node_id UUID NOT NULL REFERENCES workflow_nodes (id) ON DELETE CASCADE,
  UNIQUE (node_id, depends_on_node_id)
);

CREATE TABLE IF NOT EXISTS open_items (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  workflow_node_id UUID REFERENCES workflow_nodes (id) ON DELETE SET NULL,
  item_type TEXT NOT NULL DEFAULT 'our_action',
  status TEXT NOT NULL DEFAULT 'open',
  responsible_party TEXT NOT NULL DEFAULT 'us',
  title TEXT NOT NULL,
  description TEXT,
  close_condition TEXT,
  due_at TIMESTAMPTZ,
  external_evidence_ref TEXT,
  confidence REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hermes_change_proposals (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  suggested_action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  source_evidence JSONB,
  confidence REAL NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO workflow_templates (id, slug, name, version)
VALUES ('88888888-8888-4888-8888-888888888888', 'standard_sponsorship', '标准商单', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_template_nodes (id, template_id, slug, label, sort_order, is_required)
VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001', '88888888-8888-4888-8888-888888888888', 'business_init', '商务立项', 0, TRUE),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002', '88888888-8888-4888-8888-888888888888', 'outline', '大纲', 1, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects (id, name)
VALUES ('99999999-9999-4999-8999-999999999901', 'Legacy 迁移样例')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_workflows (id, project_id, template_id)
VALUES ('99999999-9999-4999-8999-999999999902', '99999999-9999-4999-8999-999999999901', '88888888-8888-4888-8888-888888888888')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_nodes (id, project_workflow_id, slug, label, sort_order, status)
VALUES
  ('99999999-9999-4999-8999-999999999903', '99999999-9999-4999-8999-999999999902', 'business_init', '商务立项', 0, 'completed'),
  ('99999999-9999-4999-8999-999999999904', '99999999-9999-4999-8999-999999999902', 'outline', '大纲', 1, 'in_progress')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_node_dependencies (node_id, depends_on_node_id)
VALUES ('99999999-9999-4999-8999-999999999904', '99999999-9999-4999-8999-999999999903')
ON CONFLICT DO NOTHING;

INSERT INTO open_items (id, project_id, workflow_node_id, title, description, close_condition)
VALUES (
  '99999999-9999-4999-8999-999999999905',
  '99999999-9999-4999-8999-999999999901',
  '99999999-9999-4999-8999-999999999904',
  'Legacy 待办',
  '迁移前事项',
  '甲方确认'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO hermes_change_proposals (id, project_id, idempotency_key, suggested_action, payload)
VALUES (
  '99999999-9999-4999-8999-999999999906',
  '99999999-9999-4999-8999-999999999901',
  'legacy-prop-1',
  'upsert_open_item',
  '{"title":"候选"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
