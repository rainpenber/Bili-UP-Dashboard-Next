-- WP-004: commercial projects, workflow instances, open items, Hermes proposals

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  role_labels TEXT[] NOT NULL DEFAULT '{}',
  external_identity_ref JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_template_nodes (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES workflow_templates (id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  parent_id UUID REFERENCES workflow_template_nodes (id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  dependency_mode TEXT NOT NULL DEFAULT 'all_of' CHECK (dependency_mode IN ('all_of', 'any_of')),
  completion_criteria TEXT,
  stage_key TEXT,
  UNIQUE (template_id, slug)
);

CREATE TABLE IF NOT EXISTS workflow_template_node_dependencies (
  id BIGSERIAL PRIMARY KEY,
  node_id UUID NOT NULL REFERENCES workflow_template_nodes (id) ON DELETE CASCADE,
  depends_on_node_id UUID NOT NULL REFERENCES workflow_template_nodes (id) ON DELETE CASCADE,
  UNIQUE (node_id, depends_on_node_id),
  CHECK (node_id <> depends_on_node_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  product TEXT,
  cooperation_type TEXT,
  derived_stage TEXT NOT NULL DEFAULT 'business_init',
  planned_publish_at TIMESTAMPTZ,
  owner_id UUID REFERENCES team_members (id) ON DELETE SET NULL,
  health_status TEXT NOT NULL DEFAULT 'healthy' CHECK (health_status IN ('healthy', 'at_risk', 'blocked')),
  source_status TEXT NOT NULL DEFAULT 'unknown' CHECK (
    source_status IN ('confirmed', 'auto_confirmed', 'pending_confirmation', 'conflict', 'unknown')
  ),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_derived_stage ON projects (derived_stage);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects (archived_at);

CREATE TABLE IF NOT EXISTS project_workflows (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL UNIQUE REFERENCES projects (id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES workflow_templates (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_nodes (
  id UUID PRIMARY KEY,
  project_workflow_id UUID NOT NULL REFERENCES project_workflows (id) ON DELETE CASCADE,
  template_node_id UUID REFERENCES workflow_template_nodes (id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  parent_id UUID REFERENCES workflow_nodes (id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  dependency_mode TEXT NOT NULL DEFAULT 'all_of' CHECK (dependency_mode IN ('all_of', 'any_of')),
  completion_criteria TEXT,
  stage_key TEXT,
  owner_id UUID REFERENCES team_members (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'locked' CHECK (
    status IN (
      'locked',
      'ready',
      'in_progress',
      'waiting_external',
      'blocked',
      'completed',
      'skipped'
    )
  ),
  due_at TIMESTAMPTZ,
  blocked_reason TEXT,
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (project_workflow_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow ON workflow_nodes (project_workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_status ON workflow_nodes (status);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_due ON workflow_nodes (due_at);

CREATE TABLE IF NOT EXISTS workflow_node_dependencies (
  id BIGSERIAL PRIMARY KEY,
  node_id UUID NOT NULL REFERENCES workflow_nodes (id) ON DELETE CASCADE,
  depends_on_node_id UUID NOT NULL REFERENCES workflow_nodes (id) ON DELETE CASCADE,
  UNIQUE (node_id, depends_on_node_id),
  CHECK (node_id <> depends_on_node_id)
);

CREATE TABLE IF NOT EXISTS workflow_node_status_history (
  id BIGSERIAL PRIMARY KEY,
  node_id UUID NOT NULL REFERENCES workflow_nodes (id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflow_node_history_node ON workflow_node_status_history (node_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS open_items (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  workflow_node_id UUID REFERENCES workflow_nodes (id) ON DELETE SET NULL,
  item_type TEXT NOT NULL CHECK (
    item_type IN (
      'our_action',
      'client_reply',
      'confirmation',
      'delivery',
      'revision',
      'logistics',
      'finance',
      'risk_conflict'
    )
  ),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'cancelled')),
  responsible_party TEXT NOT NULL CHECK (responsible_party IN ('us', 'client', 'both', 'unknown')),
  due_at TIMESTAMPTZ,
  title TEXT NOT NULL,
  description TEXT,
  close_condition TEXT,
  source_type TEXT,
  external_evidence_ref TEXT,
  confidence REAL,
  human_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_by UUID REFERENCES team_members (id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_open_items_project ON open_items (project_id);
CREATE INDEX IF NOT EXISTS idx_open_items_status ON open_items (status);

CREATE TABLE IF NOT EXISTS hermes_change_proposals (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accepted', 'rejected', 'superseded')
  ),
  suggested_action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  source_evidence JSONB,
  confidence REAL NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hermes_proposals_project ON hermes_change_proposals (project_id);

-- Seed team members (idempotent)
INSERT INTO team_members (id, display_name, role_labels)
VALUES
  ('11111111-1111-4111-8111-111111111111', '老板A', ARRAY['老板A']),
  ('22222222-2222-4222-8222-222222222222', '老板B', ARRAY['老板B']),
  ('33333333-3333-4333-8333-333333333333', '员工', ARRAY['员工'])
ON CONFLICT (id) DO NOTHING;

-- Standard sponsorship workflow template
INSERT INTO workflow_templates (id, slug, name, version)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'standard_sponsorship', '标准商单工作流', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_template_nodes (
  id, template_id, slug, label, parent_id, sort_order, is_required, dependency_mode, completion_criteria, stage_key
)
VALUES
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'business_init',
    '商务与立项',
    NULL,
    10,
    TRUE,
    'all_of',
    'Brief 已确认且立项完成',
    'business_init'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'outline',
    '大纲',
    NULL,
    20,
    TRUE,
    'all_of',
    '大纲定稿',
    'outline'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'copywriting',
    '文案',
    NULL,
    30,
    TRUE,
    'all_of',
    '文案定稿',
    'copywriting'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb004',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'production',
    '制作',
    NULL,
    40,
    TRUE,
    'all_of',
    '成片初剪完成',
    'production'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb005',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'review',
    '审核',
    NULL,
    50,
    TRUE,
    'all_of',
    '甲方审核通过',
    'review'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb006',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'publish',
    '发布',
    NULL,
    60,
    TRUE,
    'all_of',
    '视频已发布',
    'publish'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb007',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'go_live_monitoring',
    '上线监控',
    NULL,
    70,
    TRUE,
    'all_of',
    '监控期结束',
    'go_live_monitoring'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb008',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'settlement',
    '结算与资产收尾',
    NULL,
    80,
    TRUE,
    'all_of',
    '结算与资产归档完成',
    'settlement'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_template_node_dependencies (node_id, depends_on_node_id)
VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb004', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb005', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb004'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb006', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb005'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb007', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb006'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb008', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb007')
ON CONFLICT (node_id, depends_on_node_id) DO NOTHING;
