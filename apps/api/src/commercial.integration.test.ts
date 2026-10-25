import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  isOpenItemActor,
  isOpenItemImpact,
  isOpenItemLifecycle,
  isOverallStage,
  isPublishSource,
  isWfNodeKind,
  isWfNodeStatus,
  parseCommercialDefaultTemplate,
  parseCommercialProjectArchiveResponse,
  parseCommercialProjectDetail,
  parseCommercialProjectList,
  parseCommercialProjectWorkflow,
  type OverallStage,
  type PublishSource,
  type WfNodeKind,
  type WfNodeStatus,
} from '@studio/contracts';
import {
  FIXTURE_PROJECT_IDS,
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  isPostgresRequiredEnv,
  seedCommercialFixtures,
  type Sql,
} from '@studio/db';
import { createApp } from './app';
import { createCommercialRoutes } from './commercial-routes';

const DEFAULT_TEMPLATE = 'ffff1111-1111-4111-8111-111111111111';

type NodeRow = {
  id: string;
  project_id: string;
  name: string;
  status: string;
  kind: string;
  pos_y: number;
  pos_x: number;
  primary_block_pinned_item_id: string | null;
};

type ItemRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  close_criteria: string | null;
  next_action: string | null;
  next_actor: string;
  lifecycle: string;
  impact: string;
  planned_at: string | null;
  sort_rank: number;
  blocks_required_for_close: boolean;
  workflow_node_id: string | null;
  blocks_node_id: string | null;
  created_at: Date;
  updated_at: string;
  created_at_text: string;
};

function asOverallStage(value: string): OverallStage {
  if (!isOverallStage(value)) throw new Error(`unexpected overall stage ${value}`);
  return value;
}

function asPublishSource(value: string): PublishSource {
  if (!isPublishSource(value)) throw new Error(`unexpected publish source ${value}`);
  return value;
}

function asNodeStatus(value: string): WfNodeStatus {
  if (!isWfNodeStatus(value)) throw new Error(`unexpected node status ${value}`);
  return value;
}

function asNodeKind(value: string): WfNodeKind {
  if (!isWfNodeKind(value)) throw new Error(`unexpected node kind ${value}`);
  return value;
}

function stageNames(nodes: NodeRow[]): string[] {
  return nodes
    .filter((node) => node.status === 'in_progress' || node.status === 'blocked')
    .sort(
      (a, b) =>
        Number(a.pos_y) - Number(b.pos_y) ||
        Number(a.pos_x) - Number(b.pos_x) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((node) => node.name);
}

function blockedNames(nodes: NodeRow[]): string[] {
  return stageNames(nodes.filter((node) => node.status === 'blocked'));
}

function nodeSatisfied(nodes: NodeRow[], name: string): boolean {
  return nodes.some(
    (node) =>
      node.name === name && (node.status === 'completed' || node.status === 'not_applicable'),
  );
}

function expectedPhase(nodes: NodeRow[]): 'pending' | 'active' | 'wrapping' {
  if (nodeSatisfied(nodes, '发布')) return 'wrapping';
  if (nodeSatisfied(nodes, '文案')) return 'active';
  return 'pending';
}

function asActor(value: string) {
  if (!isOpenItemActor(value)) throw new Error(`unexpected next_actor ${value}`);
  return value;
}

function asLifecycle(value: string) {
  if (!isOpenItemLifecycle(value)) throw new Error(`unexpected lifecycle ${value}`);
  return value;
}

function asImpact(value: string) {
  if (!isOpenItemImpact(value)) throw new Error(`unexpected impact ${value}`);
  return value;
}

const STAMP = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

function blockingReason(items: ItemRow[], nodes: NodeRow[]): string | null {
  const blocked = nodes.filter((node) => node.status === 'blocked');
  const blockedIds = new Set(blocked.map((node) => node.id));
  const pinned = new Set(
    blocked
      .map((node) => node.primary_block_pinned_item_id)
      .filter((id): id is string => id !== null),
  );
  const candidates = items.filter(
    (item) =>
      item.lifecycle === 'open' &&
      item.impact === 'blocking' &&
      (pinned.has(item.id) ||
        (item.blocks_node_id !== null && blockedIds.has(item.blocks_node_id))),
  );
  candidates.sort((a, b) => {
    const pinDelta = Number(pinned.has(a.id)) - Number(pinned.has(b.id));
    if (pinDelta !== 0) return -pinDelta;
    if (a.sort_rank !== b.sort_rank) return a.sort_rank - b.sort_rank;
    const timeDelta = a.created_at.getTime() - b.created_at.getTime();
    if (timeDelta !== 0) return timeDelta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return candidates[0]?.title ?? null;
}

describe('commercial read API', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let app: ReturnType<typeof createApp> | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) {
      if (isPostgresRequiredEnv()) {
        throw new Error('PostgreSQL required in CI but isolated database setup failed');
      }
      return;
    }
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    await seedCommercialFixtures(sql);
    app = createApp({ skipDb: true });
    app.route('/api/v1/commercial', createCommercialRoutes(sql));
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('project list matches seeded money, stage, and blocked flag', async () => {
    if (!sql || !app) return;
    const res = await app.request('/api/v1/commercial/projects');
    expect(res.status).toBe(200);
    const body = parseCommercialProjectList(await res.json());

    const projects = await sql<
      {
        id: string;
        name: string;
        net_amount: string | null;
        rebate_amount: string | null;
        overall_stage: string;
        created_at: string;
        updated_at: string;
        user_deadline_at: string | null;
        blocked_since_at: string | null;
        archived_at: string | null;
        stage_entered_at: string;
        business_closed_at: string | null;
        origin_kind: string | null;
      }[]
    >`
      SELECT
        id,
        name,
        net_amount::text AS net_amount,
        rebate_amount::text AS rebate_amount,
        overall_stage,
        to_char(created_at AT TIME ZONE 'UTC', ${STAMP}) AS created_at,
        to_char(updated_at AT TIME ZONE 'UTC', ${STAMP}) AS updated_at,
        to_char(user_deadline_at AT TIME ZONE 'UTC', ${STAMP}) AS user_deadline_at,
        to_char(blocked_since_at AT TIME ZONE 'UTC', ${STAMP}) AS blocked_since_at,
        to_char(archived_at AT TIME ZONE 'UTC', ${STAMP}) AS archived_at,
        to_char(stage_entered_at AT TIME ZONE 'UTC', ${STAMP}) AS stage_entered_at,
        to_char(business_closed_at AT TIME ZONE 'UTC', ${STAMP}) AS business_closed_at,
        origin_kind
      FROM commercial_projects
      ORDER BY created_at ASC, id ASC
    `;
    const nodes = await sql<NodeRow[]>`
      SELECT id, project_id, name, status, kind, pos_y, pos_x, primary_block_pinned_item_id
      FROM wf_nodes
    `;
    const items = await sql<ItemRow[]>`
      SELECT
        id,
        project_id,
        title,
        description,
        close_criteria,
        next_action,
        next_actor,
        lifecycle,
        impact,
        to_char(planned_at AT TIME ZONE 'UTC', ${STAMP}) AS planned_at,
        sort_rank,
        blocks_required_for_close,
        workflow_node_id,
        blocks_node_id,
        created_at,
        to_char(created_at AT TIME ZONE 'UTC', ${STAMP}) AS created_at_text,
        to_char(updated_at AT TIME ZONE 'UTC', ${STAMP}) AS updated_at
      FROM open_items
      ORDER BY project_id ASC, sort_rank ASC, created_at ASC, id ASC
    `;
    const nodesByProject = new Map<string, NodeRow[]>();
    for (const node of nodes) {
      const list = nodesByProject.get(node.project_id) ?? [];
      list.push(node);
      nodesByProject.set(node.project_id, list);
    }
    const itemsByProject = new Map<string, ItemRow[]>();
    for (const item of items) {
      const list = itemsByProject.get(item.project_id) ?? [];
      list.push(item);
      itemsByProject.set(item.project_id, list);
    }

    const activeProjects = projects.filter((project) => project.archived_at === null);
    expect(body.total).toBe(activeProjects.length);
    expect(body.limit).toBeNull();
    expect(body.offset).toBe(0);
    expect(body.items.map((item) => item.id)).toEqual(activeProjects.map((project) => project.id));
    expect(body.items.some((item) => item.id === FIXTURE_PROJECT_IDS.archived)).toBe(false);
    for (const [index, project] of activeProjects.entries()) {
      const item = body.items[index];
      const projectNodes = nodesByProject.get(project.id) ?? [];
      const projectItems = itemsByProject.get(project.id) ?? [];
      expect(item).toEqual({
        id: project.id,
        name: project.name,
        netAmount: project.net_amount,
        rebateAmount: project.rebate_amount,
        overallStage: asOverallStage(project.overall_stage),
        phase: expectedPhase(projectNodes),
        currentStageNames: stageNames(projectNodes),
        anyNodeBlocked: projectNodes.some((node) => node.status === 'blocked'),
        blockingReason: blockingReason(projectItems, projectNodes),
        createdAt: project.created_at,
        updatedAt: project.updated_at,
        userDeadlineAt: project.user_deadline_at,
        blockedSinceAt: project.blocked_since_at,
        archivedAt: project.archived_at,
        stageEnteredAt: project.stage_entered_at,
        businessClosedAt: project.business_closed_at,
        originKind:
          project.origin_kind === 'real' ||
          project.origin_kind === 'fixture' ||
          project.origin_kind === 'manual'
            ? project.origin_kind
            : null,
        source: null,
        businessState: null,
        originStatusLabel: null,
        sourceWindow: null,
        blockedNodeNames: blockedNames(projectNodes),
        openItems: projectItems.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          closeCriteria: row.close_criteria,
          nextAction: row.next_action,
          nextActor: asActor(row.next_actor),
          lifecycle: asLifecycle(row.lifecycle),
          impact: asImpact(row.impact),
          plannedAt: row.planned_at,
          sortRank: row.sort_rank,
          blocksRequiredForClose: row.blocks_required_for_close,
          workflowNodeId: row.workflow_node_id,
          blocksNodeId: row.blocks_node_id,
          createdAt: row.created_at_text,
          updatedAt: row.updated_at,
        })),
      });
      for (const openItem of item?.openItems ?? []) {
        expect(projectItems.some((row) => row.id === openItem.id)).toBe(true);
      }
    }

    const client = body.items.find((item) => item.id === FIXTURE_PROJECT_IDS.clientBlocking);
    expect(client).toMatchObject({
      name: '甲方卡文案确认样例',
      netAmount: '18000.00',
      rebateAmount: '600.00',
      currentStageNames: ['文案', '预拍摄'],
      anyNodeBlocked: true,
    });
  }, 30_000);

  test('project list phase follows the 文案 and 发布 thresholds', async () => {
    if (!sql || !app) return;
    const res = await app.request('/api/v1/commercial/projects');
    expect(res.status).toBe(200);
    const body = parseCommercialProjectList(await res.json());
    const byId = new Map(body.items.map((item) => [item.id, item]));
    expect(byId.get(FIXTURE_PROJECT_IDS.freshInquiryOnly)?.phase).toBe('pending');
    expect(byId.get(FIXTURE_PROJECT_IDS.multiBlock)?.phase).toBe('active');
    expect(byId.get(FIXTURE_PROJECT_IDS.publishedOpen)?.phase).toBe('wrapping');

    const paged = parseCommercialProjectList(
      await (await app.request('/api/v1/commercial/projects?limit=2&offset=1')).json(),
    );
    expect(paged.total).toBe(body.total);
    expect(paged.limit).toBe(2);
    expect(paged.offset).toBe(1);
    expect(paged.items.map((item) => item.id)).toEqual(
      body.items.slice(1, 3).map((item) => item.id),
    );
  }, 30_000);

  test('project detail matches blocking reason and publish status', async () => {
    if (!sql || !app) return;
    const nodes = await sql<NodeRow[]>`
      SELECT id, project_id, name, status, kind, pos_y, pos_x, primary_block_pinned_item_id
      FROM wf_nodes
    `;
    const items = await sql<ItemRow[]>`
      SELECT id, project_id, title, lifecycle, impact, sort_rank, created_at, blocks_node_id
      FROM open_items
    `;
    const publishes = await sql<
      {
        project_id: string;
        bvid: string;
        published_at: Date;
        publish_source: string;
        idempotency_key: string;
      }[]
    >`
      SELECT project_id, bvid, published_at, publish_source, idempotency_key FROM project_publish_records
    `;
    const publishByProject = new Map(publishes.map((row) => [row.project_id, row]));

    for (const projectId of Object.values(FIXTURE_PROJECT_IDS)) {
      const res = await app.request(`/api/v1/commercial/projects/${projectId}`);
      expect(res.status).toBe(200);
      const detail = parseCommercialProjectDetail(await res.json());
      const projectNodes = nodes.filter((node) => node.project_id === projectId);
      const projectItems = items.filter((item) => item.project_id === projectId);
      const publish = publishByProject.get(projectId);
      expect(detail.currentStageNames).toEqual(stageNames(projectNodes));
      expect(detail.blockingReason).toBe(blockingReason(projectItems, projectNodes));
      expect(detail.anyNodeBlocked).toBe(projectNodes.some((node) => node.status === 'blocked'));
      expect(detail.blockedNodeNames).toEqual(blockedNames(projectNodes));
      const orderedItems = [...projectItems].sort((a, b) => {
        if (a.sort_rank !== b.sort_rank) return a.sort_rank - b.sort_rank;
        const timeDelta = a.created_at.getTime() - b.created_at.getTime();
        if (timeDelta !== 0) return timeDelta;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      expect(detail.openItems.map((item) => item.id)).toEqual(orderedItems.map((item) => item.id));
      expect(detail.openItems.every((item) => orderedItems.some((row) => row.id === item.id))).toBe(
        true,
      );
      if (publish) {
        expect(detail.publish).toEqual({
          published: true,
          bvid: publish.bvid,
          publishedAt: publish.published_at.toISOString(),
          publishSource: asPublishSource(publish.publish_source),
          idempotencyKey: publish.idempotency_key,
        });
      } else {
        expect(detail.publish).toEqual({
          published: false,
          bvid: null,
          publishedAt: null,
          publishSource: null,
          idempotencyKey: null,
        });
      }
    }

    const client = await app.request(
      `/api/v1/commercial/projects/${FIXTURE_PROJECT_IDS.clientBlocking}`,
    );
    expect(parseCommercialProjectDetail(await client.json()).blockingReason).toBe(
      '甲方文案批注未清',
    );

    const multi = await app.request(
      `/api/v1/commercial/projects/${FIXTURE_PROJECT_IDS.multiBlock}`,
    );
    const multiDetail = parseCommercialProjectDetail(await multi.json());
    expect(multiDetail.blockingReason).toBe('B-roll 甲方素材缺失');
    expect(multiDetail.currentStageNames).toEqual(['A-roll 拍摄', 'B-roll 素材', 'AI 后期']);

    const multiWorkflow = await app.request(
      `/api/v1/commercial/projects/${FIXTURE_PROJECT_IDS.multiBlock}/workflow`,
    );
    const multiGraph = parseCommercialProjectWorkflow(await multiWorkflow.json());
    expect(multiGraph.nodes.find((node) => node.templateSlug === 'b_roll')).toMatchObject({
      name: 'B-roll 素材',
      status: 'blocked',
      blockingReason: 'B-roll 甲方素材缺失',
    });
    expect(multiGraph.nodes.find((node) => node.templateSlug === 'a_roll')).toMatchObject({
      name: 'A-roll 拍摄',
      status: 'blocked',
      blockingReason: 'A-roll 素材版权待补',
    });
    const clientWorkflow = await app.request(
      `/api/v1/commercial/projects/${FIXTURE_PROJECT_IDS.clientBlocking}/workflow`,
    );
    const clientGraph = parseCommercialProjectWorkflow(await clientWorkflow.json());
    expect(clientGraph.nodes.find((node) => node.templateSlug === 'copy')).toMatchObject({
      name: '文案',
      status: 'blocked',
      blockingReason: '甲方文案批注未清',
    });

    const published = await app.request(
      `/api/v1/commercial/projects/${FIXTURE_PROJECT_IDS.publishedOpen}`,
    );
    expect(parseCommercialProjectDetail(await published.json()).publish).toEqual({
      published: true,
      bvid: 'BVWP004R01',
      publishedAt: '2026-05-20T12:00:00.000Z',
      publishSource: 'web',
      idempotencyKey: 'fixture-publish-once',
    });
  }, 30_000);

  test('workflow graph matches rows and includes the merge node kind', async () => {
    if (!sql || !app) return;
    for (const projectId of Object.values(FIXTURE_PROJECT_IDS)) {
      const res = await app.request(`/api/v1/commercial/projects/${projectId}/workflow`);
      expect(res.status).toBe(200);
      const graph = parseCommercialProjectWorkflow(await res.json());
      const rows = await sql<
        {
          id: string;
          name: string;
          status: string;
          kind: string;
          template_slug: string | null;
          blocking_reason: string | null;
          workflow_id: string;
          planned_at: string | null;
          completed_at: string | null;
          pos_x: number;
          pos_y: number;
          updated_at: string;
        }[]
      >`
        SELECT
          n.id,
          n.name,
          n.status,
          n.kind,
          t.slug AS template_slug,
          (
            SELECT oi.title
            FROM open_items oi
            WHERE n.status = 'blocked'
              AND oi.project_id = n.project_id
              AND oi.lifecycle = 'open'
              AND oi.impact = 'blocking'
              AND (
                oi.id = n.primary_block_pinned_item_id
                OR oi.blocks_node_id = n.id
              )
            ORDER BY
              (oi.id = n.primary_block_pinned_item_id) DESC,
              oi.sort_rank ASC,
              oi.created_at ASC,
              oi.id ASC
            LIMIT 1
          ) AS blocking_reason,
          n.workflow_id,
          to_char(n.planned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS planned_at,
          to_char(n.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS completed_at,
          n.pos_x,
          n.pos_y,
          to_char(n.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
        FROM wf_nodes n
        LEFT JOIN wf_template_nodes t ON t.id = n.template_node_id
        WHERE n.project_id = ${projectId}
        ORDER BY n.pos_y, n.pos_x, n.id
      `;
      const workflowId = rows[0]?.workflow_id;
      if (!workflowId) throw new Error(`project ${projectId} has no workflow nodes`);
      expect(graph.projectId).toBe(projectId);
      expect(graph.templateVersionId).toBe(DEFAULT_TEMPLATE);
      expect(graph.workflowId).toBe(workflowId);
      expect(graph.nodes).toEqual(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          status: asNodeStatus(row.status),
          kind: asNodeKind(row.kind),
          templateSlug: row.template_slug,
          blockingReason: row.blocking_reason,
          plannedAt: row.planned_at,
          completedAt: row.completed_at,
          posX: row.pos_x,
          posY: row.pos_y,
          updatedAt: row.updated_at,
        })),
      );
      const merge = graph.nodes.filter((node) => node.kind === 'merge');
      expect(merge).toHaveLength(1);
      expect(merge[0]?.name).toBe('汇合节点');
      const edges = await sql<{ id: string }[]>`
        SELECT e.id
        FROM wf_edges e
        JOIN project_workflows w ON w.id = e.workflow_id
        WHERE w.project_id = ${projectId}
      `;
      expect(graph.edges).toHaveLength(edges.length);
      expect(new Set(graph.edges.map((edge) => edge.id))).toEqual(
        new Set(edges.map((edge) => edge.id)),
      );
      expect(graph.nodes).toHaveLength(14);
      expect(graph.edges).toHaveLength(16);
    }
  }, 30_000);

  test('default template endpoint matches the published 14/16 seed', async () => {
    if (!sql || !app) return;
    const res = await app.request('/api/v1/commercial/templates/default');
    expect(res.status).toBe(200);
    const template = parseCommercialDefaultTemplate(await res.json());
    const [version] = await sql<{ id: string; name: string; published_at: Date }[]>`
      SELECT id, name, published_at
      FROM wf_template_versions
      WHERE slug = 'default_sponsorship' AND is_default = TRUE AND is_draft = FALSE
    `;
    if (!version) throw new Error('published default template is missing');
    expect(template.id).toBe(version.id);
    expect(template.id).toBe(DEFAULT_TEMPLATE);
    expect(template.slug).toBe('default_sponsorship');
    expect(template.name).toBe(version.name);
    expect(template.version).toBe(1);
    expect(template.publishedAt).toBe(version.published_at.toISOString());

    const dbNodes = await sql<
      { id: string; slug: string; name: string; kind: string; is_optional: boolean }[]
    >`
      SELECT id, slug, name, kind, is_optional
      FROM wf_template_nodes
      WHERE template_version_id = ${DEFAULT_TEMPLATE}
      ORDER BY pos_y, pos_x, id
    `;
    expect(template.nodes).toEqual(
      dbNodes.map((node) => ({
        id: node.id,
        slug: node.slug,
        name: node.name,
        kind: asNodeKind(node.kind),
        isOptional: node.is_optional,
      })),
    );
    expect(template.nodes).toHaveLength(14);
    expect(template.edges).toHaveLength(16);
    const merge = template.nodes.filter((node) => node.kind === 'merge');
    expect(merge).toEqual([
      expect.objectContaining({ name: '汇合节点', slug: 'merge', kind: 'merge', isOptional: true }),
    ]);

    const nameById = new Map(template.nodes.map((node) => [node.id, node.name]));
    const pairs = template.edges.map(
      (edge) => `${nameById.get(edge.fromNodeId)}->${nameById.get(edge.toNodeId)}`,
    );
    expect(
      pairs.filter((pair) => pair.endsWith('->汇合节点') || pair.startsWith('汇合节点->')).sort(),
    ).toEqual(
      [
        '文案->汇合节点',
        '预拍摄->汇合节点',
        '汇合节点->A-roll 拍摄',
        '汇合节点->B-roll 素材',
        '汇合节点->AI 后期',
      ].sort(),
    );
  }, 30_000);

  test('missing projects and write methods are not served', async () => {
    if (!app) return;
    const missing = '00000000-0000-4000-8000-000000000099';
    const detail = await app.request(`/api/v1/commercial/projects/${missing}`);
    expect(detail.status).toBe(404);
    expect(await detail.json()).toEqual({ error: 'project not found' });
    const workflow = await app.request(`/api/v1/commercial/projects/${missing}/workflow`);
    expect(workflow.status).toBe(404);
    const invalid = await app.request('/api/v1/commercial/projects/not-a-uuid');
    expect(invalid.status).toBe(400);

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await app.request('/api/v1/commercial/projects', { method });
      expect(res.status).toBe(404);
    }
    const proposal = await app.request('/api/v1/commercial/proposals');
    expect(proposal.status).toBe(404);
  });

  test('a blocked merge node without an open item has a null blocking reason', async () => {
    if (!sql || !app) return;
    const projectId = 'bb100001-0001-4001-8001-000000000001';
    const workflowId = 'bb100002-0001-4001-8001-000000000002';
    const nodeId = 'bb100003-0001-4001-8001-000000000003';
    await sql`
      INSERT INTO commercial_projects (id, name, net_amount, rebate_amount)
      VALUES (${projectId}, '阻塞无原因', 100, 0)
    `;
    await sql`
      INSERT INTO project_workflows (id, project_id, template_version_id)
      VALUES (${workflowId}, ${projectId}, ${DEFAULT_TEMPLATE})
    `;
    await sql`
      INSERT INTO wf_nodes (
        id, workflow_id, project_id, template_version_id, name, kind, status, is_optional
      )
      VALUES (
        ${nodeId}, ${workflowId}, ${projectId}, ${DEFAULT_TEMPLATE}, '汇合节点', 'merge', 'blocked', TRUE
      )
    `;

    const detailRes = await app.request(`/api/v1/commercial/projects/${projectId}`);
    expect(detailRes.status).toBe(200);
    const detail = parseCommercialProjectDetail(await detailRes.json());
    expect(detail.anyNodeBlocked).toBe(true);
    expect(detail.blockingReason).toBeNull();
    expect(detail.currentStageNames).toEqual(['汇合节点']);
    expect(detail.blockedNodeNames).toEqual(['汇合节点']);
    expect(detail.openItems).toEqual([]);
    expect(detail.userDeadlineAt).toBeNull();
    expect(detail.blockedSinceAt).toBeNull();
    expect(detail.netAmount).toBe('100.00');

    const graphRes = await app.request(`/api/v1/commercial/projects/${projectId}/workflow`);
    const graph = parseCommercialProjectWorkflow(await graphRes.json());
    const [stamp] = await sql<{ updated_at: string; pos_x: number; pos_y: number }[]>`
      SELECT
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
        pos_x,
        pos_y
      FROM wf_nodes WHERE id = ${nodeId}
    `;
    if (!stamp) throw new Error('blocked node timestamp missing');
    expect(graph.nodes).toEqual([
      {
        id: nodeId,
        name: '汇合节点',
        status: 'blocked',
        kind: 'merge',
        templateSlug: null,
        blockingReason: null,
        plannedAt: null,
        completedAt: null,
        posX: stamp.pos_x,
        posY: stamp.pos_y,
        updatedAt: stamp.updated_at,
      },
    ]);

    const bareId = 'bb100004-0001-4001-8001-000000000004';
    await sql`INSERT INTO commercial_projects (id, name) VALUES (${bareId}, '无流程')`;
    const bareWorkflow = await app.request(`/api/v1/commercial/projects/${bareId}/workflow`);
    expect(bareWorkflow.status).toBe(404);
    expect(await bareWorkflow.json()).toEqual({ error: 'workflow not found' });

    const bareDetail = parseCommercialProjectDetail(
      await (await app.request(`/api/v1/commercial/projects/${bareId}`)).json(),
    );
    expect(bareDetail.netAmount).toBeNull();
    expect(bareDetail.rebateAmount).toBeNull();
    expect(bareDetail.currentStageNames).toEqual([]);
    expect(bareDetail.blockedNodeNames).toEqual([]);
    expect(bareDetail.anyNodeBlocked).toBe(false);
    expect(bareDetail.userDeadlineAt).toBeNull();
    expect(bareDetail.openItems).toEqual([]);
  });

  test('open items stay on their project when dates and lifecycle are missing or closed', async () => {
    if (!sql || !app) return;
    const archivedId = 'bb100005-0001-4001-8001-000000000005';
    const otherId = 'bb100006-0001-4001-8001-000000000006';
    const closedId = 'bb100007-0001-4001-8001-000000000007';
    const openId = 'bb100008-0001-4001-8001-000000000008';
    await sql`
      INSERT INTO commercial_projects (id, name, net_amount, rebate_amount, overall_stage, user_deadline_at, archived_at)
      VALUES
        (${archivedId}, '缺日期归档样例', NULL, NULL, 'archived', NULL, ${'2026-02-02T00:00:00.000Z'}),
        (${otherId}, '另一项目样例', NULL, '12.50', 'pre_publish', NULL, NULL)
    `;
    await sql`
      INSERT INTO open_items (
        id, project_id, title, description, close_criteria, next_action, next_actor, lifecycle, impact, planned_at, sort_rank
      )
      VALUES
        (
          ${closedId}, ${archivedId}, '已关闭事项', NULL, NULL, NULL, 'us', 'closed', 'normal', NULL, 0
        ),
        (
          ${openId}, ${otherId}, '对方开放事项', '只属于另一项目', NULL, '催回复', 'client', 'open', 'blocking', NULL, 3
        )
    `;

    const archivedRes = await app.request(`/api/v1/commercial/projects/${archivedId}`);
    const archived = parseCommercialProjectDetail(await archivedRes.json());
    const [archivedRow] = await sql<
      {
        created_at: string;
        archived_at: string;
        stage_entered_at: string;
        item_created_at: string;
        item_updated_at: string;
      }[]
    >`
      SELECT
        to_char(p.created_at AT TIME ZONE 'UTC', ${STAMP}) AS created_at,
        to_char(p.archived_at AT TIME ZONE 'UTC', ${STAMP}) AS archived_at,
        to_char(p.stage_entered_at AT TIME ZONE 'UTC', ${STAMP}) AS stage_entered_at,
        to_char(oi.created_at AT TIME ZONE 'UTC', ${STAMP}) AS item_created_at,
        to_char(oi.updated_at AT TIME ZONE 'UTC', ${STAMP}) AS item_updated_at
      FROM commercial_projects p
      JOIN open_items oi ON oi.project_id = p.id AND oi.id = ${closedId}
      WHERE p.id = ${archivedId}
    `;
    if (!archivedRow) throw new Error('archived fixture row missing');
    expect(archived.netAmount).toBeNull();
    expect(archived.rebateAmount).toBeNull();
    expect(archived.overallStage).toBe('archived');
    expect(archived.userDeadlineAt).toBeNull();
    expect(archived.blockedSinceAt).toBeNull();
    expect(archived.archivedAt).toBe(archivedRow.archived_at);
    expect(archived.createdAt).toBe(archivedRow.created_at);
    expect(archived.businessClosedAt).toBeNull();
    expect(archived.currentStageNames).toEqual([]);
    expect(archived.openItems).toEqual([
      {
        id: closedId,
        title: '已关闭事项',
        description: null,
        closeCriteria: null,
        nextAction: null,
        nextActor: 'us',
        lifecycle: 'closed',
        impact: 'normal',
        plannedAt: null,
        sortRank: 0,
        blocksRequiredForClose: false,
        workflowNodeId: null,
        blocksNodeId: null,
        createdAt: archivedRow.item_created_at,
        updatedAt: archivedRow.item_updated_at,
      },
    ]);
    expect(archived.openItems.some((item) => item.title === '对方开放事项')).toBe(false);

    const other = parseCommercialProjectDetail(
      await (await app.request(`/api/v1/commercial/projects/${otherId}`)).json(),
    );
    expect(other.rebateAmount).toBe('12.50');
    expect(other.netAmount).toBeNull();
    expect(other.openItems.map((item) => item.id)).toEqual([openId]);
    expect(other.openItems[0]).toMatchObject({
      title: '对方开放事项',
      nextAction: '催回复',
      nextActor: 'client',
      lifecycle: 'open',
      impact: 'blocking',
      plannedAt: null,
      sortRank: 3,
    });
    expect(other.openItems.some((item) => item.id === closedId)).toBe(false);

    const listDefault = parseCommercialProjectList(
      await (await app.request('/api/v1/commercial/projects')).json(),
    );
    expect(listDefault.items.find((item) => item.id === archivedId)).toBeUndefined();
    const listedOther = listDefault.items.find((item) => item.id === otherId);
    expect(listedOther?.openItems.map((item) => item.id)).toEqual([openId]);

    const listWithArchived = parseCommercialProjectList(
      await (await app.request('/api/v1/commercial/projects?includeArchived=1')).json(),
    );
    const listedArchived = listWithArchived.items.find((item) => item.id === archivedId);
    expect(listedArchived?.openItems.map((item) => item.id)).toEqual([closedId]);
  });

  test('archive soft-deletes without cascade; unarchive restores; list total matches', async () => {
    if (!sql || !app) return;
    const projectId = FIXTURE_PROJECT_IDS.freshInquiryOnly;

    const beforeDefault = parseCommercialProjectList(
      await (await app.request('/api/v1/commercial/projects')).json(),
    );
    const beforeAll = parseCommercialProjectList(
      await (await app.request('/api/v1/commercial/projects?includeArchived=1')).json(),
    );
    expect(beforeDefault.items.some((item) => item.id === projectId)).toBe(true);
    expect(beforeAll.total).toBeGreaterThan(beforeDefault.total);

    const [snapshot] = await sql<
      {
        name: string;
        net_amount: string | null;
        rebate_amount: string | null;
        overall_stage: string;
        origin_kind: string | null;
        node_count: string;
        source_count: string;
      }[]
    >`
      SELECT
        p.name,
        p.net_amount::text AS net_amount,
        p.rebate_amount::text AS rebate_amount,
        p.overall_stage,
        p.origin_kind,
        (SELECT count(*)::text FROM wf_nodes n WHERE n.project_id = p.id) AS node_count,
        (SELECT count(*)::text FROM commercial_project_sources s WHERE s.project_id = p.id) AS source_count
      FROM commercial_projects p
      WHERE p.id = ${projectId}
    `;
    if (!snapshot) throw new Error('fixture project missing');

    const archiveRes = await app.request(`/api/v1/commercial/projects/${projectId}/archive`, {
      method: 'POST',
    });
    expect(archiveRes.status).toBe(200);
    const archived = parseCommercialProjectArchiveResponse(await archiveRes.json());
    expect(archived.id).toBe(projectId);
    expect(archived.archivedAt).not.toBeNull();

    const archiveAgain = parseCommercialProjectArchiveResponse(
      await (
        await app.request(`/api/v1/commercial/projects/${projectId}/archive`, { method: 'POST' })
      ).json(),
    );
    expect(archiveAgain.archivedAt).toBe(archived.archivedAt);

    const missing = await app.request(
      '/api/v1/commercial/projects/00000000-0000-4000-8000-000000000099/archive',
      { method: 'POST' },
    );
    expect(missing.status).toBe(404);

    const afterDefault = parseCommercialProjectList(
      await (await app.request('/api/v1/commercial/projects')).json(),
    );
    expect(afterDefault.items.some((item) => item.id === projectId)).toBe(false);
    expect(afterDefault.total).toBe(beforeDefault.total - 1);

    const afterAll = parseCommercialProjectList(
      await (await app.request('/api/v1/commercial/projects?includeArchived=1')).json(),
    );
    expect(afterAll.total).toBe(beforeAll.total);
    expect(afterAll.items.find((item) => item.id === projectId)?.archivedAt).toBe(
      archived.archivedAt,
    );

    const detail = parseCommercialProjectDetail(
      await (await app.request(`/api/v1/commercial/projects/${projectId}`)).json(),
    );
    expect(detail.archivedAt).toBe(archived.archivedAt);
    expect(detail.name).toBe(snapshot.name);
    expect(detail.netAmount).toBe(snapshot.net_amount);
    expect(detail.rebateAmount).toBe(snapshot.rebate_amount);
    expect(detail.overallStage).toBe(asOverallStage(snapshot.overall_stage));

    const workflow = parseCommercialProjectWorkflow(
      await (await app.request(`/api/v1/commercial/projects/${projectId}/workflow`)).json(),
    );
    expect(String(workflow.nodes.length)).toBe(snapshot.node_count);

    const [afterArchiveRow] = await sql<
      {
        overall_stage: string;
        net_amount: string | null;
        rebate_amount: string | null;
        origin_kind: string | null;
        node_count: string;
        source_count: string;
      }[]
    >`
      SELECT
        p.overall_stage,
        p.net_amount::text AS net_amount,
        p.rebate_amount::text AS rebate_amount,
        p.origin_kind,
        (SELECT count(*)::text FROM wf_nodes n WHERE n.project_id = p.id) AS node_count,
        (SELECT count(*)::text FROM commercial_project_sources s WHERE s.project_id = p.id) AS source_count
      FROM commercial_projects p
      WHERE p.id = ${projectId}
    `;
    expect(afterArchiveRow).toMatchObject({
      overall_stage: snapshot.overall_stage,
      net_amount: snapshot.net_amount,
      rebate_amount: snapshot.rebate_amount,
      origin_kind: snapshot.origin_kind,
      node_count: snapshot.node_count,
      source_count: snapshot.source_count,
    });

    const unarchiveRes = await app.request(`/api/v1/commercial/projects/${projectId}/unarchive`, {
      method: 'POST',
    });
    expect(unarchiveRes.status).toBe(200);
    const restored = parseCommercialProjectArchiveResponse(await unarchiveRes.json());
    expect(restored.archivedAt).toBeNull();

    const unarchiveAgain = parseCommercialProjectArchiveResponse(
      await (
        await app.request(`/api/v1/commercial/projects/${projectId}/unarchive`, { method: 'POST' })
      ).json(),
    );
    expect(unarchiveAgain.archivedAt).toBeNull();

    const restoredDefault = parseCommercialProjectList(
      await (await app.request('/api/v1/commercial/projects')).json(),
    );
    expect(restoredDefault.total).toBe(beforeDefault.total);
    expect(restoredDefault.items.some((item) => item.id === projectId)).toBe(true);

    const missingUnarchive = await app.request(
      '/api/v1/commercial/projects/00000000-0000-4000-8000-000000000099/unarchive',
      { method: 'POST' },
    );
    expect(missingUnarchive.status).toBe(404);

    const badQuery = await app.request('/api/v1/commercial/projects?includeArchived=yes');
    expect(badQuery.status).toBe(400);

    // Real-origin row: same soft-archive path, no cascade.
    const realId = 'bb100019-0001-4001-8001-000000000019';
    await sql`
      INSERT INTO commercial_projects (id, name, net_amount, rebate_amount, overall_stage, origin_kind)
      VALUES (${realId}, '真实接入软删样例', 9900, 100, 'pre_publish', 'real')
    `;
    await sql`
      INSERT INTO commercial_project_sources (
        id, project_id, namespace, source_id, origin_kind,
        source_updated_at, imported_at, payload, content_hash, source_status
      )
      VALUES (
        ${'bb10001a-0001-4001-8001-00000000001a'}, ${realId}, 'hermes.test', 'real-soft-archive-1', 'real',
        ${'2026-10-01T00:00:00.000Z'}, ${'2026-10-01T00:00:00.000Z'}, '{}'::jsonb, 'hash-real-soft', '2.进行中'
      )
    `;
    const realArchive = parseCommercialProjectArchiveResponse(
      await (
        await app.request(`/api/v1/commercial/projects/${realId}/archive`, { method: 'POST' })
      ).json(),
    );
    expect(realArchive.archivedAt).not.toBeNull();
    const [realRow] = await sql<
      { origin_kind: string; source_id: string | null; net_amount: string | null }[]
    >`
      SELECT p.origin_kind, s.source_id, p.net_amount::text AS net_amount
      FROM commercial_projects p
      LEFT JOIN commercial_project_sources s ON s.project_id = p.id
      WHERE p.id = ${realId}
    `;
    expect(realRow).toEqual({
      origin_kind: 'real',
      source_id: 'real-soft-archive-1',
      net_amount: '9900.00',
    });
    const realDetail = parseCommercialProjectDetail(
      await (await app.request(`/api/v1/commercial/projects/${realId}`)).json(),
    );
    expect(realDetail.originKind).toBe('real');
    expect(realDetail.source?.sourceId).toBe('real-soft-archive-1');
    expect(realDetail.businessState).toBe('active');
    expect(realDetail.sourceWindow).toEqual({
      startAt: null,
      endAt: null,
      reminderAt: null,
    });
  });

  test('list and detail expose sourceWindow dates without payload chat text (WP-R2-22A)', async () => {
    if (!sql || !app) return;
    const hisenseId = 'bb100022-0001-4001-8001-000000000022';
    const djiId = 'bb100023-0001-4001-8001-000000000023';
    const emptyId = 'bb100024-0001-4001-8001-000000000024';
    await sql`
      INSERT INTO commercial_projects (id, name, net_amount, rebate_amount, overall_stage, origin_kind)
      VALUES
        (${hisenseId}, '海信E8S', NULL, NULL, 'pre_publish', 'real'),
        (${djiId}, '大疆 Pocket4', NULL, NULL, 'pre_publish', 'real'),
        (${emptyId}, '无档期真实单', NULL, NULL, 'pre_publish', 'real')
    `;
    await sql`
      INSERT INTO commercial_project_sources (
        id, project_id, namespace, source_id, origin_kind,
        source_updated_at, imported_at, payload, content_hash, source_status
      )
      VALUES
        (
          ${'bb100022-a001-4001-8001-000000000022'}, ${hisenseId}, 'hermes.wechat', 'hisense-e8s', 'real',
          ${'2026-10-01T00:00:00.000Z'}, ${'2026-10-01T00:00:00.000Z'},
          ${sql.json({
            startAt: '2025-09-18',
            endAt: '2025-10-21',
            title: '海信E8S',
            chatSnippet: '客户聊天原文不得出现在详情响应',
          })},
          'hash-hisense', '2.进行中'
        ),
        (
          ${'bb100023-a001-4001-8001-000000000023'}, ${djiId}, 'hermes.wechat', 'dji-pocket4', 'real',
          ${'2026-10-01T00:00:00.000Z'}, ${'2026-10-01T00:00:00.000Z'},
          ${sql.json({
            startAt: '2025-09-01',
            endAt: '2025-10-19',
            reminderAt: '2025-08-28T09:00:00+08:00',
          })},
          'hash-dji', '2.进行中'
        ),
        (
          ${'bb100024-a001-4001-8001-000000000024'}, ${emptyId}, 'hermes.wechat', 'no-window', 'real',
          ${'2026-10-01T00:00:00.000Z'}, ${'2026-10-01T00:00:00.000Z'},
          ${sql.json({ title: '无档期' })},
          'hash-empty-window', '2.进行中'
        )
    `;

    const hisense = parseCommercialProjectDetail(
      await (await app.request(`/api/v1/commercial/projects/${hisenseId}`)).json(),
    );
    expect(hisense.sourceWindow).toEqual({
      startAt: '2025-09-17T16:00:00.000Z',
      endAt: '2025-10-20T16:00:00.000Z',
      reminderAt: null,
    });
    expect(JSON.stringify(hisense)).not.toContain('客户聊天');
    expect(JSON.stringify(hisense)).not.toContain('chatSnippet');

    const dji = parseCommercialProjectDetail(
      await (await app.request(`/api/v1/commercial/projects/${djiId}`)).json(),
    );
    expect(dji.sourceWindow).toEqual({
      startAt: '2025-08-31T16:00:00.000Z',
      endAt: '2025-10-18T16:00:00.000Z',
      reminderAt: '2025-08-28T01:00:00.000Z',
    });

    const empty = parseCommercialProjectDetail(
      await (await app.request(`/api/v1/commercial/projects/${emptyId}`)).json(),
    );
    expect(empty.sourceWindow).toEqual({
      startAt: null,
      endAt: null,
      reminderAt: null,
    });

    const list = parseCommercialProjectList(
      await (await app.request('/api/v1/commercial/projects?originKind=real')).json(),
    );
    const listed = list.items.find((item) => item.id === hisenseId);
    expect(listed?.sourceWindow?.startAt).toBe('2025-09-17T16:00:00.000Z');
    expect(JSON.stringify(list)).not.toContain('客户聊天');
  });
});
