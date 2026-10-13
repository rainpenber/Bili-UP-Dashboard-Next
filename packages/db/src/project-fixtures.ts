import type { Sql } from './client';

/** Fixed anchor for deterministic relative dates in tests and fixtures. */
export const FIXTURE_NOW_ISO = '2026-06-15T00:00:00.000Z';

export const FIXTURE_PROJECT_IDS = {
  progressing: 'aaaaaaaa-0001-4001-8001-000000000001',
  clientBlocked: 'aaaaaaaa-0001-4001-8001-000000000002',
  overdue: 'aaaaaaaa-0001-4001-8001-000000000003',
  archived: 'aaaaaaaa-0001-4001-8001-000000000004',
} as const;

const TEMPLATE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAFF = '33333333-3333-4333-8333-333333333333';
const BOSS_B = '22222222-2222-4222-8222-222222222222';

const TEMPLATE_NODE_IDS = [
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb004',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb005',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb006',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb007',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb008',
] as const;

type FixtureSpec = {
  id: string;
  name: string;
  brand: string;
  derivedStage: string;
  health: string;
  archived: boolean;
  ownerId: string;
  publishAt: string;
  nodeStatuses: string[];
  blockedReason?: string;
  openItem?: {
    id: string;
    title: string;
    type: string;
    party: string;
    dueAt: string;
  };
};

const SPECS: FixtureSpec[] = [
  {
    id: FIXTURE_PROJECT_IDS.progressing,
    name: 'Fixture 正常推进',
    brand: '品牌 Alpha',
    derivedStage: 'production',
    health: 'healthy',
    archived: false,
    ownerId: STAFF,
    publishAt: '2026-07-01T00:00:00.000Z',
    nodeStatuses: [
      'completed',
      'completed',
      'completed',
      'in_progress',
      'locked',
      'locked',
      'locked',
      'locked',
    ],
  },
  {
    id: FIXTURE_PROJECT_IDS.clientBlocked,
    name: 'Fixture 甲方阻塞',
    brand: '品牌 Beta',
    derivedStage: 'review',
    health: 'blocked',
    archived: false,
    ownerId: BOSS_B,
    publishAt: '2026-06-20T00:00:00.000Z',
    nodeStatuses: [
      'completed',
      'completed',
      'completed',
      'completed',
      'waiting_external',
      'locked',
      'locked',
      'locked',
    ],
    blockedReason: '等待甲方确认脚本修改',
  },
  {
    id: FIXTURE_PROJECT_IDS.overdue,
    name: 'Fixture 逾期我方事项',
    brand: '品牌 Gamma',
    derivedStage: 'copywriting',
    health: 'at_risk',
    archived: false,
    ownerId: STAFF,
    publishAt: '2026-06-18T00:00:00.000Z',
    nodeStatuses: [
      'completed',
      'completed',
      'in_progress',
      'locked',
      'locked',
      'locked',
      'locked',
      'locked',
    ],
    openItem: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0003',
      title: '补齐报价附件',
      type: 'our_action',
      party: 'us',
      dueAt: '2026-06-10T00:00:00.000Z',
    },
  },
  {
    id: FIXTURE_PROJECT_IDS.archived,
    name: 'Fixture 已归档',
    brand: '品牌 Delta',
    derivedStage: 'completed',
    health: 'healthy',
    archived: true,
    ownerId: BOSS_B,
    publishAt: '2026-05-01T00:00:00.000Z',
    nodeStatuses: [
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
    ],
  },
];

async function instantiateWorkflow(
  sql: Sql,
  projectId: string,
  nodeStatuses: string[],
  blockedReason?: string,
): Promise<string> {
  const workflowId = crypto.randomUUID();
  await sql`
    INSERT INTO project_workflows (id, project_id, template_id)
    VALUES (${workflowId}, ${projectId}, ${TEMPLATE_ID})
    ON CONFLICT (project_id) DO NOTHING
  `;
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM project_workflows WHERE project_id = ${projectId}
  `;
  const pwId = existing[0]?.id ?? workflowId;

  for (let i = 0; i < TEMPLATE_NODE_IDS.length; i++) {
    const templateNodeId = TEMPLATE_NODE_IDS[i]!;
    const status = nodeStatuses[i] ?? 'locked';
    const nodeId = crypto.randomUUID();
    const rows = await sql<
      {
        slug: string;
        label: string;
        sort_order: number;
        is_required: boolean;
        dependency_mode: string;
        completion_criteria: string | null;
        stage_key: string | null;
      }[]
    >`
      SELECT slug, label, sort_order, is_required, dependency_mode, completion_criteria, stage_key
      FROM workflow_template_nodes WHERE id = ${templateNodeId}
    `;
    const tn = rows[0];
    if (!tn) continue;
    await sql`
      INSERT INTO workflow_nodes (
        id, project_workflow_id, template_node_id, slug, label, sort_order, is_required,
        dependency_mode, completion_criteria, stage_key, owner_id, status, blocked_reason, due_at
      )
      VALUES (
        ${nodeId}, ${pwId}, ${templateNodeId}, ${tn.slug}, ${tn.label}, ${tn.sort_order},
        ${tn.is_required}, ${tn.dependency_mode}, ${tn.completion_criteria}, ${tn.stage_key},
        ${STAFF}, ${status},
        ${i === 4 && blockedReason ? blockedReason : null},
        ${i === 3 ? '2026-06-20T00:00:00.000Z' : null}
      )
      ON CONFLICT (project_workflow_id, slug) DO UPDATE SET
        status = EXCLUDED.status,
        blocked_reason = EXCLUDED.blocked_reason
    `;
  }

  const instNodes = await sql<{ id: string; slug: string }[]>`
    SELECT id, slug FROM workflow_nodes WHERE project_workflow_id = ${pwId} ORDER BY sort_order
  `;
  for (let i = 1; i < instNodes.length; i++) {
    const nodeId = instNodes[i]!.id;
    const predId = instNodes[i - 1]!.id;
    await sql`
      INSERT INTO workflow_node_dependencies (node_id, depends_on_node_id)
      VALUES (${nodeId}, ${predId})
      ON CONFLICT (node_id, depends_on_node_id) DO NOTHING
    `;
  }
  return pwId;
}

export async function seedProjectFixtures(sql: Sql): Promise<void> {
  for (const spec of SPECS) {
    await sql`
      INSERT INTO projects (
        id, name, brand, product, cooperation_type, derived_stage, planned_publish_at,
        owner_id, health_status, source_status, archived_at
      )
      VALUES (
        ${spec.id}, ${spec.name}, ${spec.brand}, '产品样例', '植入',
        ${spec.derivedStage}, ${spec.publishAt}, ${spec.ownerId}, ${spec.health},
        'confirmed', ${spec.archived ? FIXTURE_NOW_ISO : null}
      )
      ON CONFLICT (id) DO UPDATE SET
        derived_stage = EXCLUDED.derived_stage,
        health_status = EXCLUDED.health_status,
        archived_at = EXCLUDED.archived_at,
        updated_at = now()
    `;
    await instantiateWorkflow(sql, spec.id, spec.nodeStatuses, spec.blockedReason);
    if (spec.openItem) {
      await sql`
        INSERT INTO open_items (
          id, project_id, item_type, status, responsible_party, due_at, title, close_condition
        )
        VALUES (
          ${spec.openItem.id}, ${spec.id}, ${spec.openItem.type}, 'open',
          ${spec.openItem.party}, ${spec.openItem.dueAt}, ${spec.openItem.title},
          '附件上传至项目文件夹'
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }
  }
}
