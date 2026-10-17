import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  isOverallStage,
  isPublishSource,
  isWfNodeKind,
  isWfNodeStatus,
  parseCommercialDefaultTemplate,
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
  lifecycle: string;
  impact: string;
  sort_rank: number;
  created_at: Date;
  blocks_node_id: string | null;
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
      }[]
    >`
      SELECT id, name, net_amount::text AS net_amount, rebate_amount::text AS rebate_amount, overall_stage
      FROM commercial_projects
      ORDER BY created_at ASC, id ASC
    `;
    const nodes = await sql<NodeRow[]>`
      SELECT id, project_id, name, status, kind, pos_y, pos_x, primary_block_pinned_item_id
      FROM wf_nodes
    `;
    const nodesByProject = new Map<string, NodeRow[]>();
    for (const node of nodes) {
      const list = nodesByProject.get(node.project_id) ?? [];
      list.push(node);
      nodesByProject.set(node.project_id, list);
    }

    expect(body.items.map((item) => item.id)).toEqual(projects.map((project) => project.id));
    for (const [index, project] of projects.entries()) {
      const item = body.items[index];
      const projectNodes = nodesByProject.get(project.id) ?? [];
      expect(item).toEqual({
        id: project.id,
        name: project.name,
        netAmount: project.net_amount,
        rebateAmount: project.rebate_amount,
        overallStage: asOverallStage(project.overall_stage),
        currentStageNames: stageNames(projectNodes),
        anyNodeBlocked: projectNodes.some((node) => node.status === 'blocked'),
      });
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
      { project_id: string; bvid: string; published_at: Date; publish_source: string }[]
    >`
      SELECT project_id, bvid, published_at, publish_source FROM project_publish_records
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
      if (publish) {
        expect(detail.publish).toEqual({
          published: true,
          bvid: publish.bvid,
          publishedAt: publish.published_at.toISOString(),
          publishSource: asPublishSource(publish.publish_source),
        });
      } else {
        expect(detail.publish).toEqual({
          published: false,
          bvid: null,
          publishedAt: null,
          publishSource: null,
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

    const published = await app.request(
      `/api/v1/commercial/projects/${FIXTURE_PROJECT_IDS.publishedOpen}`,
    );
    expect(parseCommercialProjectDetail(await published.json()).publish).toEqual({
      published: true,
      bvid: 'BVWP004R01',
      publishedAt: '2026-05-20T12:00:00.000Z',
      publishSource: 'web',
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
    expect(detail.netAmount).toBe('100.00');

    const graphRes = await app.request(`/api/v1/commercial/projects/${projectId}/workflow`);
    const graph = parseCommercialProjectWorkflow(await graphRes.json());
    const [stamp] = await sql<{ updated_at: string }[]>`
      SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
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
        updatedAt: stamp.updated_at,
      },
    ]);

    const bareId = 'bb100004-0001-4001-8001-000000000004';
    await sql`INSERT INTO commercial_projects (id, name) VALUES (${bareId}, '无流程')`;
    const bareWorkflow = await app.request(`/api/v1/commercial/projects/${bareId}/workflow`);
    expect(bareWorkflow.status).toBe(404);
    expect(await bareWorkflow.json()).toEqual({ error: 'workflow not found' });
  });
});
