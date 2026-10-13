import { createHash } from 'node:crypto';
import type { Sql } from './client';

export const FIXTURE_PROJECT_IDS = {
  outlineDebate: 'f0010001-0001-4001-8001-000000000001',
  productionParallel: 'f0010001-0001-4001-8001-000000000002',
  publishedOpen: 'f0010001-0001-4001-8001-000000000003',
  clientBlocking: 'f0010001-0001-4001-8001-000000000004',
  hermesPending: 'f0010001-0001-4001-8001-000000000005',
  archived: 'f0010001-0001-4001-8001-000000000006',
  multiBlock: 'f0010001-0001-4001-8001-000000000007',
  optionalNa: 'f0010001-0001-4001-8001-000000000008',
  freshInquiryOnly: 'f0010001-0001-4001-8001-000000000009',
  settlementOverdue: 'f0010001-0001-4001-8001-000000000010',
  publishReady: 'f0010001-0001-4001-8001-000000000011',
  businessClosed: 'f0010001-0001-4001-8001-000000000012',
  rebateDispute: 'f0010001-0001-4001-8001-000000000013',
} as const;

const FIXTURE_PROJECT_ID_LIST = Object.values(FIXTURE_PROJECT_IDS);

const DEFAULT_TEMPLATE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const FIXTURE_UUID_NS = 'studio-commercial-fixture-v1';

const PRE_PUBLISH_DONE = [
  'inquiry',
  'outline',
  'copy',
  'pre_shoot',
  'a_roll',
  'b_roll',
  'ai_post',
  'review',
  'publish',
] as const;

function fixtureDerivedUuid(kind: string, ...parts: string[]): string {
  const h = createHash('sha256')
    .update(FIXTURE_UUID_NS)
    .update('\0')
    .update(kind)
    .update('\0')
    .update(parts.join('\0'))
    .digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export function fixtureNodeId(projectId: string, templateSlug: string): string {
  return fixtureDerivedUuid('node', projectId, templateSlug);
}

function fixtureWorkflowId(projectId: string): string {
  return fixtureDerivedUuid('workflow', projectId);
}

function fixturePackageId(projectId: string, templatePackageId: string): string {
  return fixtureDerivedUuid('package', projectId, templatePackageId);
}

function fixtureEdgeId(
  projectId: string,
  fromTemplateNodeId: string,
  toTemplateNodeId: string,
): string {
  return fixtureDerivedUuid('edge', projectId, fromTemplateNodeId, toTemplateNodeId);
}

type NodeStatus = 'not_reached' | 'in_progress' | 'completed' | 'blocked' | 'not_applicable';

function defaultNodeStatus(projectId: string, slug: string): NodeStatus {
  if (slug === 'inquiry') return 'completed';

  if (projectId === FIXTURE_PROJECT_IDS.outlineDebate && slug === 'outline') return 'in_progress';

  if (
    projectId === FIXTURE_PROJECT_IDS.productionParallel &&
    ['a_roll', 'b_roll', 'ai_post'].includes(slug)
  ) {
    return 'in_progress';
  }

  if (projectId === FIXTURE_PROJECT_IDS.publishedOpen) {
    if (PRE_PUBLISH_DONE.includes(slug as (typeof PRE_PUBLISH_DONE)[number])) return 'completed';
    if (slug === 'settlement') return 'in_progress';
  }

  if (projectId === FIXTURE_PROJECT_IDS.clientBlocking) {
    if (['inquiry', 'outline'].includes(slug)) return 'completed';
    if (slug === 'copy') return 'blocked';
    if (slug === 'pre_shoot') return 'in_progress';
  }

  if (projectId === FIXTURE_PROJECT_IDS.hermesPending) {
    if (['inquiry', 'outline'].includes(slug)) return 'completed';
    if (slug === 'copy') return 'in_progress';
  }

  if (projectId === FIXTURE_PROJECT_IDS.archived) {
    if (PRE_PUBLISH_DONE.includes(slug as (typeof PRE_PUBLISH_DONE)[number])) return 'completed';
    if (slug === 'settlement') return 'in_progress';
  }

  if (projectId === FIXTURE_PROJECT_IDS.multiBlock) {
    if (['inquiry', 'outline', 'copy', 'pre_shoot'].includes(slug)) return 'completed';
    if (['a_roll', 'b_roll'].includes(slug)) return 'blocked';
    if (slug === 'ai_post') return 'in_progress';
  }

  if (projectId === FIXTURE_PROJECT_IDS.optionalNa) {
    if (PRE_PUBLISH_DONE.includes(slug as (typeof PRE_PUBLISH_DONE)[number])) return 'completed';
    if (['settlement', 'distribution', 'data_maint'].includes(slug)) return 'completed';
    if (slug === 'other') return 'not_applicable';
  }

  if (projectId === FIXTURE_PROJECT_IDS.freshInquiryOnly) {
    return slug === 'inquiry' ? 'completed' : 'not_reached';
  }

  if (projectId === FIXTURE_PROJECT_IDS.settlementOverdue) {
    if (PRE_PUBLISH_DONE.includes(slug as (typeof PRE_PUBLISH_DONE)[number])) return 'completed';
    if (slug === 'settlement') return 'in_progress';
    if (slug === 'distribution') return 'in_progress';
  }

  if (projectId === FIXTURE_PROJECT_IDS.publishReady) {
    if (
      ['inquiry', 'outline', 'copy', 'pre_shoot', 'a_roll', 'b_roll', 'ai_post', 'review'].includes(
        slug,
      )
    ) {
      return 'completed';
    }
    if (slug === 'publish') return 'in_progress';
  }

  if (projectId === FIXTURE_PROJECT_IDS.businessClosed) {
    if (slug === 'other') return 'not_applicable';
    return 'completed';
  }

  if (projectId === FIXTURE_PROJECT_IDS.rebateDispute) {
    if (PRE_PUBLISH_DONE.includes(slug as (typeof PRE_PUBLISH_DONE)[number])) return 'completed';
    if (slug === 'settlement') return 'blocked';
    if (slug === 'distribution') return 'not_reached';
  }

  return 'not_reached';
}

async function seedProjectWorkflowGraph(
  sql: Sql,
  projectId: string,
  resolveStatus: (slug: string) => NodeStatus = (slug) => defaultNodeStatus(projectId, slug),
): Promise<Map<string, string>> {
  const workflowId = fixtureWorkflowId(projectId);
  await sql`
    INSERT INTO project_workflows (id, project_id, template_version_id)
    VALUES (${workflowId}, ${projectId}, ${DEFAULT_TEMPLATE})
    ON CONFLICT (project_id) DO NOTHING
  `;
  const wfRow = await sql<{ id: string }[]>`
    SELECT id FROM project_workflows WHERE project_id = ${projectId}
  `;
  const resolvedWorkflowId = wfRow[0]?.id;
  const slugToNodeId = new Map<string, string>();
  if (!resolvedWorkflowId) return slugToNodeId;

  const existingNodes = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM wf_nodes WHERE workflow_id = ${resolvedWorkflowId}
  `;
  if (Number(existingNodes[0]?.c ?? '0') > 0) {
    const existing = await sql<{ id: string; slug: string | null }[]>`
      SELECT n.id, t.slug
      FROM wf_nodes n
      LEFT JOIN wf_template_nodes t ON t.id = n.template_node_id
      WHERE n.workflow_id = ${resolvedWorkflowId}
    `;
    for (const row of existing) {
      if (row.slug) slugToNodeId.set(row.slug, row.id);
    }
    return slugToNodeId;
  }

  const tplPackages = await sql<{ id: string; name: string; sort_order: number }[]>`
    SELECT id, name, sort_order FROM wf_template_packages WHERE template_version_id = ${DEFAULT_TEMPLATE}
  `;
  const pkgMap = new Map<string, string>();
  for (const pkg of tplPackages) {
    const pkgId = fixturePackageId(projectId, pkg.id);
    pkgMap.set(pkg.id, pkgId);
    await sql`
      INSERT INTO wf_packages (id, workflow_id, name, sort_order)
      VALUES (${pkgId}, ${resolvedWorkflowId}, ${pkg.name}, ${pkg.sort_order})
      ON CONFLICT DO NOTHING
    `;
  }

  const tplNodes = await sql<
    {
      id: string;
      slug: string;
      name: string;
      is_optional: boolean;
      pos_x: number;
      pos_y: number;
      package_id: string | null;
      phase: string;
    }[]
  >`
    SELECT id, slug, name, is_optional, pos_x, pos_y, package_id, phase FROM wf_template_nodes
    WHERE template_version_id = ${DEFAULT_TEMPLATE}
  `;
  const idMap = new Map<string, string>();
  for (const tn of tplNodes) {
    const nodeId = fixtureNodeId(projectId, tn.slug);
    idMap.set(tn.id, nodeId);
    slugToNodeId.set(tn.slug, nodeId);
    const status = resolveStatus(tn.slug);
    const instancePkg = tn.package_id ? (pkgMap.get(tn.package_id) ?? null) : null;
    await sql`
      INSERT INTO wf_nodes (id, workflow_id, project_id, template_node_id, package_id, name, status, is_optional, pos_x, pos_y, phase, source)
      VALUES (${nodeId}, ${resolvedWorkflowId}, ${projectId}, ${tn.id}, ${instancePkg}, ${tn.name}, ${status}, ${tn.is_optional}, ${tn.pos_x}, ${tn.pos_y}, ${tn.phase}, 'template')
      ON CONFLICT DO NOTHING
    `;
  }

  const tplEdges = await sql<{ from_node_id: string; to_node_id: string }[]>`
    SELECT from_node_id, to_node_id FROM wf_template_edges WHERE template_version_id = ${DEFAULT_TEMPLATE}
  `;
  for (const e of tplEdges) {
    const fromId = idMap.get(e.from_node_id);
    const toId = idMap.get(e.to_node_id);
    if (!fromId || !toId) continue;
    await sql`
      INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
      VALUES (${fixtureEdgeId(projectId, e.from_node_id, e.to_node_id)}, ${resolvedWorkflowId}, ${fromId}, ${toId})
      ON CONFLICT DO NOTHING
    `;
  }

  return slugToNodeId;
}

export async function seedCommercialFixtures(sql: Sql): Promise<void> {
  await sql`
    INSERT INTO commercial_projects (id, name, net_amount, rebate_amount, overall_stage, user_deadline_at, archived_at, business_closed_at)
    VALUES
      (${FIXTURE_PROJECT_IDS.outlineDebate}, '大纲方向拉扯样例', 12000, 800, 'pre_publish', ${'2026-07-01T00:00:00.000Z'}, NULL, NULL),
      (${FIXTURE_PROJECT_IDS.productionParallel}, '制作并行样例', 28000, 1200, 'pre_publish', ${'2026-07-15T00:00:00.000Z'}, NULL, NULL),
      (${FIXTURE_PROJECT_IDS.publishedOpen}, '已上线未收尾样例', 45000, 3500, 'published_winding_down', ${'2026-06-01T00:00:00.000Z'}, NULL, NULL),
      (${FIXTURE_PROJECT_IDS.clientBlocking}, '甲方卡文案确认样例', 18000, 600, 'pre_publish', ${'2026-08-01T00:00:00.000Z'}, NULL, NULL),
      (${FIXTURE_PROJECT_IDS.hermesPending}, 'Hermes 待审写入样例', 22000, 900, 'pre_publish', ${'2026-08-10T00:00:00.000Z'}, NULL, NULL),
      (${FIXTURE_PROJECT_IDS.archived}, '已归档历史商单样例', 15000, 500, 'archived', ${'2025-12-01T00:00:00.000Z'}, ${'2026-01-15T00:00:00.000Z'}, NULL),
      (${FIXTURE_PROJECT_IDS.multiBlock}, '多节点并行阻塞样例', 32000, 1400, 'pre_publish', ${'2026-08-20T00:00:00.000Z'}, NULL, NULL),
      (${FIXTURE_PROJECT_IDS.optionalNa}, '可选节点不适用样例', 38000, 2000, 'published_winding_down', ${'2026-05-15T00:00:00.000Z'}, NULL, NULL),
      (${FIXTURE_PROJECT_IDS.freshInquiryOnly}, '新询单仅询单完成样例', 8000, 0, 'pre_publish', ${'2026-09-01T00:00:00.000Z'}, NULL, NULL),
      (${FIXTURE_PROJECT_IDS.settlementOverdue}, '结算跟进逾期样例', 52000, 4200, 'published_winding_down', ${'2026-04-01T00:00:00.000Z'}, NULL, NULL),
      (${FIXTURE_PROJECT_IDS.publishReady}, '审核已过待发片样例', 36000, 1800, 'pre_publish', ${'2026-07-20T00:00:00.000Z'}, NULL, NULL),
      (${FIXTURE_PROJECT_IDS.businessClosed}, '商单已结案样例', 48000, 3000, 'closed', ${'2026-03-01T00:00:00.000Z'}, NULL, ${'2026-06-10T00:00:00.000Z'}),
      (${FIXTURE_PROJECT_IDS.rebateDispute}, '返点争议卡结算样例', 41000, 6500, 'published_winding_down', ${'2026-05-25T00:00:00.000Z'}, NULL, NULL)
    ON CONFLICT (id) DO NOTHING
  `;

  for (const projectId of FIXTURE_PROJECT_ID_LIST) {
    await seedProjectWorkflowGraph(sql, projectId);
  }

  const outlineItemId = 'f0a10001-0001-4001-8001-0000000000a1';
  await sql`
    INSERT INTO open_items (id, project_id, title, description, close_criteria, next_action, next_actor, lifecycle, impact, source_evidence, confidence)
    VALUES (
      ${outlineItemId}, ${FIXTURE_PROJECT_IDS.outlineDebate},
      '大纲方向确认', '十余句沟通聚合为同一议题', '甲方确认方向', '整理备选结构发给甲方', 'us', 'open', 'normal',
      ${JSON.stringify({ thread: 'fixture-outline-thread', messages: 12 })}::jsonb, 0.85
    )
    ON CONFLICT (id) DO NOTHING
  `;

  const clientBlockItemId = 'f0a10001-0001-4001-8001-0000000000a4';
  await sql`
    INSERT INTO open_items (
      id, project_id, workflow_node_id, blocks_node_id, title, description, close_criteria, next_action, next_actor, lifecycle, impact, source_evidence, confidence
    )
    VALUES (
      ${clientBlockItemId}, ${FIXTURE_PROJECT_IDS.clientBlocking},
      ${fixtureNodeId(FIXTURE_PROJECT_IDS.clientBlocking, 'copy')},
      ${fixtureNodeId(FIXTURE_PROJECT_IDS.clientBlocking, 'copy')},
      '甲方文案批注未清', '三处口径待甲方确认', '甲方书面确认终稿', '跟进甲方群回复', 'client', 'open', 'blocking',
      ${JSON.stringify({ thread: 'fixture-client-copy-thread', messages: 8 })}::jsonb, 0.9
    )
    ON CONFLICT (id) DO NOTHING
  `;

  const multiBlockA = 'f0a10001-0001-4001-8001-0000000000b1';
  const multiBlockB = 'f0a10001-0001-4001-8001-0000000000b2';
  await sql`
    INSERT INTO open_items (
      id, project_id, workflow_node_id, blocks_node_id, title, next_action, next_actor, lifecycle, impact, sort_rank
    )
    VALUES
      (
        ${multiBlockA}, ${FIXTURE_PROJECT_IDS.multiBlock},
        ${fixtureNodeId(FIXTURE_PROJECT_IDS.multiBlock, 'a_roll')},
        ${fixtureNodeId(FIXTURE_PROJECT_IDS.multiBlock, 'a_roll')},
        'A-roll 素材版权待补', '联系素材方补授权', 'us', 'open', 'blocking', 2
      ),
      (
        ${multiBlockB}, ${FIXTURE_PROJECT_IDS.multiBlock},
        ${fixtureNodeId(FIXTURE_PROJECT_IDS.multiBlock, 'b_roll')},
        ${fixtureNodeId(FIXTURE_PROJECT_IDS.multiBlock, 'b_roll')},
        'B-roll 甲方素材缺失', '催甲方提供原片', 'client', 'open', 'blocking', 1
      )
    ON CONFLICT (id) DO NOTHING
  `;

  const rebateItemId = 'f0a10001-0001-4001-8001-0000000000d1';
  await sql`
    INSERT INTO open_items (
      id, project_id, workflow_node_id, blocks_node_id, title, description, close_criteria, next_action, next_actor, lifecycle, impact, blocks_required_for_close, source_evidence, confidence
    )
    VALUES (
      ${rebateItemId}, ${FIXTURE_PROJECT_IDS.rebateDispute},
      ${fixtureNodeId(FIXTURE_PROJECT_IDS.rebateDispute, 'settlement')},
      ${fixtureNodeId(FIXTURE_PROJECT_IDS.rebateDispute, 'settlement')},
      '返点比例争议', '合同返点与对账单不一致', '双方确认最终返点金额', '整理对账差异表', 'client', 'open', 'blocking', TRUE,
      ${JSON.stringify({ thread: 'fixture-rebate-thread', messages: 15 })}::jsonb, 0.88
    )
    ON CONFLICT (id) DO NOTHING
  `;

  const hermesProposalId = 'f0b10001-0001-4001-8001-000000000005';
  await sql`
    INSERT INTO hermes_write_proposals (id, project_id, idempotency_key, operation, status, payload, source_evidence, confidence)
    VALUES (
      ${hermesProposalId}, ${FIXTURE_PROJECT_IDS.hermesPending}, 'fixture-hermes-pending-copy-advance', 'advance_node', 'pending',
      ${JSON.stringify({
        projectId: FIXTURE_PROJECT_IDS.hermesPending,
        nodeId: fixtureNodeId(FIXTURE_PROJECT_IDS.hermesPending, 'copy'),
      })}::jsonb,
      ${JSON.stringify({ source: 'fixture-wechat', excerpt: '文案可以开写了' })}::jsonb,
      0.62
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO project_publish_records (project_id, bvid, published_at, publish_source, forced_complete_audit, idempotency_key)
    VALUES
      (
        ${FIXTURE_PROJECT_IDS.publishedOpen}, 'BVWP004R01', ${'2026-05-20T12:00:00.000Z'}, 'web',
        ${JSON.stringify([{ node: 'publish', reason: 'publish_force_complete' }])}::jsonb,
        'fixture-publish-once'
      ),
      (
        ${FIXTURE_PROJECT_IDS.optionalNa}, 'BVWP004R08', ${'2026-05-10T10:00:00.000Z'}, 'web',
        ${JSON.stringify([{ node: 'publish', reason: 'publish_force_complete' }])}::jsonb,
        'fixture-publish-optional-na'
      ),
      (
        ${FIXTURE_PROJECT_IDS.settlementOverdue}, 'BVWP004R10', ${'2026-03-15T08:00:00.000Z'}, 'manual',
        ${JSON.stringify([{ node: 'publish', reason: 'publish_force_complete' }])}::jsonb,
        'fixture-publish-settlement-overdue'
      ),
      (
        ${FIXTURE_PROJECT_IDS.businessClosed}, 'BVWP004R12', ${'2026-05-01T09:00:00.000Z'}, 'web',
        ${JSON.stringify([{ node: 'publish', reason: 'publish_force_complete' }])}::jsonb,
        'fixture-publish-business-closed'
      ),
      (
        ${FIXTURE_PROJECT_IDS.rebateDispute}, 'BVWP004R13', ${'2026-04-28T14:00:00.000Z'}, 'hermes',
        ${JSON.stringify([{ node: 'publish', reason: 'publish_force_complete' }])}::jsonb,
        'fixture-publish-rebate-dispute'
      )
    ON CONFLICT (project_id) DO NOTHING
  `;

  await sql`
    INSERT INTO videos (bvid, title, metadata)
    VALUES ('BVTEST001', 'Fixture 监控视频', ${JSON.stringify({ source: 'fixture' })}::jsonb)
    ON CONFLICT (bvid) DO NOTHING
  `;
  await sql`
    INSERT INTO project_monitor_contracts (id, project_id, bvid, monitor_video_key, linked_bvid, metadata_task_status, metrics_fetch_due_at)
    VALUES (
      ${'f0a00001-0001-4001-8001-000000000003'}, ${FIXTURE_PROJECT_IDS.publishedOpen}, 'BVWP004R01', 'BVTEST001', 'BVTEST001', 'mock_ready',
      ${'2026-05-20T12:01:00.000Z'}
    )
    ON CONFLICT (project_id) DO NOTHING
  `;
}

export async function countCommercialFixtureRows(sql: Sql): Promise<{
  commercialProjects: number;
  projectWorkflows: number;
  wfNodes: number;
  wfEdges: number;
  wfPackages: number;
  openItems: number;
  publishRecords: number;
  monitorContracts: number;
  hermesProposals: number;
}> {
  const [commercialProjects] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM commercial_projects WHERE id = ANY(${FIXTURE_PROJECT_ID_LIST})
  `;
  const [projectWorkflows] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM project_workflows WHERE project_id = ANY(${FIXTURE_PROJECT_ID_LIST})
  `;
  const [wfNodes] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM wf_nodes WHERE project_id = ANY(${FIXTURE_PROJECT_ID_LIST})
  `;
  const [wfEdges] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM wf_edges e
    INNER JOIN project_workflows w ON w.id = e.workflow_id
    WHERE w.project_id = ANY(${FIXTURE_PROJECT_ID_LIST})
  `;
  const [wfPackages] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM wf_packages p
    INNER JOIN project_workflows w ON w.id = p.workflow_id
    WHERE w.project_id = ANY(${FIXTURE_PROJECT_ID_LIST})
  `;
  const [openItems] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM open_items WHERE project_id = ANY(${FIXTURE_PROJECT_ID_LIST})
  `;
  const [publishRecords] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM project_publish_records WHERE project_id = ANY(${FIXTURE_PROJECT_ID_LIST})
  `;
  const [monitorContracts] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM project_monitor_contracts WHERE project_id = ANY(${FIXTURE_PROJECT_ID_LIST})
  `;
  const [hermesProposals] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM hermes_write_proposals WHERE project_id = ANY(${FIXTURE_PROJECT_ID_LIST})
  `;
  return {
    commercialProjects: Number(commercialProjects?.c ?? 0),
    projectWorkflows: Number(projectWorkflows?.c ?? 0),
    wfNodes: Number(wfNodes?.c ?? 0),
    wfEdges: Number(wfEdges?.c ?? 0),
    wfPackages: Number(wfPackages?.c ?? 0),
    openItems: Number(openItems?.c ?? 0),
    publishRecords: Number(publishRecords?.c ?? 0),
    monitorContracts: Number(monitorContracts?.c ?? 0),
    hermesProposals: Number(hermesProposals?.c ?? 0),
  };
}
