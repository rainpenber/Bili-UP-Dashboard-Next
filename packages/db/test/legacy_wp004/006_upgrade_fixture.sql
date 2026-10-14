-- One legacy project on historical standard_sponsorship template (post 004/005 migrations)

INSERT INTO projects (id, name, derived_stage, created_at, updated_at)
VALUES (
  '99999999-9999-4999-8999-999999999901',
  'Legacy Upgrade Project',
  'outline',
  '2020-01-01T00:00:00Z',
  '2020-01-01T00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_workflows (id, project_id, template_id, created_at)
VALUES (
  '99999999-9999-4999-8999-999999999902',
  '99999999-9999-4999-8999-999999999901',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '2020-01-01T00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_nodes (
  id, project_workflow_id, template_node_id, slug, label, sort_order, is_required, status, status_changed_at
)
VALUES
  (
    '99999999-9999-4999-8999-999999999903',
    '99999999-9999-4999-8999-999999999902',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001',
    'business_init',
    '商务与立项',
    10,
    TRUE,
    'completed',
    '2020-02-01T00:00:00Z'
  ),
  (
    '99999999-9999-4999-8999-999999999904',
    '99999999-9999-4999-8999-999999999902',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002',
    'outline',
    '大纲',
    20,
    TRUE,
    'in_progress',
    '2020-06-15T08:30:00Z'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_node_dependencies (node_id, depends_on_node_id)
VALUES ('99999999-9999-4999-8999-999999999904', '99999999-9999-4999-8999-999999999903')
ON CONFLICT (node_id, depends_on_node_id) DO NOTHING;

INSERT INTO workflow_node_status_history (node_id, from_status, to_status, changed_at, note)
VALUES (
  '99999999-9999-4999-8999-999999999904',
  'locked',
  'in_progress',
  '2020-06-15T08:30:00Z',
  'Legacy 状态备注：甲方已确认大纲方向'
);

INSERT INTO open_items (
  id, project_id, workflow_node_id, title, status, responsible_party, created_at, updated_at
)
VALUES (
  '99999999-9999-4999-8999-999999999905',
  '99999999-9999-4999-8999-999999999901',
  '99999999-9999-4999-8999-999999999904',
  'Legacy 待办',
  'open',
  'us',
  '2020-06-01T00:00:00Z',
  '2020-06-01T00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;
