import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  parseCommercialProjectWorkflow,
  parseCommercialWorkflowLayoutResponse,
  parseCommercialWriteError,
  type CommercialProjectWorkflow,
} from '@studio/contracts';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  isPostgresRequiredEnv,
  type Sql,
} from '@studio/db';
import { createApp } from './app';
import { createCommercialRoutes } from './commercial-routes';

const DEFAULT_TEMPLATE = 'ffff1111-1111-4111-8111-111111111111';

type App = ReturnType<typeof createApp>;

describe('commercial workflow layout', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let app: App | null = null;

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
    app = createApp({ skipDb: true });
    app.route('/api/v1/commercial', createCommercialRoutes(sql));
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('renames and moves nodes, rejects conflicts, and writes audit', async () => {
    const ctx = await ready(sql, app);
    if (!ctx) return;

    const before = await reload(ctx);
    expect(before.nodes.every((node) => typeof node.posX === 'number')).toBe(true);
    const outline = nodeOf(before, '大纲');
    const copy = nodeOf(before, '文案');
    const edgeCount = before.edges.length;

    const [auditsBefore] = await ctx.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM domain_audit_events WHERE project_id = ${ctx.projectId}
    `;

    const renamed = parseCommercialWorkflowLayoutResponse(
      await expectJson(
        await patchLayout(ctx, {
          nodes: fullSet(before, {
            [outline.id]: { name: '大纲定稿', posX: 120, posY: 40 },
            [copy.id]: { posX: copy.posX + 10, posY: copy.posY + 5 },
          }),
        }),
        200,
      ),
    );
    expect(renamed.nodes.find((node) => node.id === outline.id)?.name).toBe('大纲定稿');
    expect(renamed.nodes.find((node) => node.id === outline.id)?.posX).toBe(120);
    expect(renamed.nodes.find((node) => node.id === outline.id)?.posY).toBe(40);
    expect(renamed.nodes.find((node) => node.id === copy.id)?.name).toBe('文案');
    expect(renamed.nodes.find((node) => node.id === copy.id)?.posX).toBe(copy.posX + 10);

    const after = await reload(ctx);
    expect(after.nodes.find((node) => node.id === outline.id)?.name).toBe('大纲定稿');
    expect(after.nodes.find((node) => node.id === outline.id)?.posX).toBe(120);
    expect(after.edges).toHaveLength(edgeCount);
    expect(after.nodes).toHaveLength(before.nodes.length);

    const [auditsAfter] = await ctx.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM domain_audit_events WHERE project_id = ${ctx.projectId}
    `;
    expect(Number(auditsAfter?.count)).toBe(Number(auditsBefore?.count) + 1);
    const [audit] = await ctx.sql<{ action: string; detail: { changes: unknown[] } }[]>`
      SELECT action, detail
      FROM domain_audit_events
      WHERE project_id = ${ctx.projectId} AND action = 'layout'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(audit?.action).toBe('layout');
    expect(Array.isArray(audit?.detail?.changes)).toBe(true);
    expect(audit?.detail.changes.length).toBeGreaterThanOrEqual(1);

    const duplicate = parseCommercialWriteError(
      await expectJson(
        await patchLayout(ctx, {
          nodes: fullSet(after, { [outline.id]: { name: '文案' } }),
        }),
        409,
      ),
    );
    expect(duplicate.code).toBe('constraint_violation');
    expect(duplicate.error).toContain('文案');

    const blank = parseCommercialWriteError(
      await expectJson(
        await patchLayout(ctx, {
          nodes: fullSet(after, { [outline.id]: { name: '   ' } }),
        }),
        400,
      ),
    );
    expect(blank.code).toBe('invalid_body');

    const tooLong = parseCommercialWriteError(
      await expectJson(
        await patchLayout(ctx, {
          nodes: fullSet(after, { [outline.id]: { name: 'x'.repeat(61) } }),
        }),
        400,
      ),
    );
    expect(tooLong.code).toBe('invalid_body');

    const staleToken = outline.updatedAt;
    const stale = parseCommercialWriteError(
      await expectJson(
        await patchLayout(ctx, {
          nodes: after.nodes.map((node) =>
            node.id === outline.id
              ? {
                  nodeId: node.id,
                  expectedUpdatedAt: staleToken,
                  name: '过期令牌改名',
                }
              : { nodeId: node.id, expectedUpdatedAt: node.updatedAt },
          ),
        }),
        409,
      ),
    );
    expect(stale.code).toBe('stale_write');
    expect((await reload(ctx)).nodes.find((node) => node.id === outline.id)?.name).toBe('大纲定稿');

    const missing = parseCommercialWriteError(
      await expectJson(
        await patchLayout(ctx, {
          nodes: after.nodes
            .filter((node) => node.id !== copy.id)
            .map((node) => ({
              nodeId: node.id,
              expectedUpdatedAt: node.updatedAt,
              ...(node.id === outline.id ? { name: '缺节点' } : {}),
            })),
        }),
        409,
      ),
    );
    expect(missing.code).toBe('constraint_violation');
    expect(missing.error).toContain('集合');

    const extra = parseCommercialWriteError(
      await expectJson(
        await patchLayout(ctx, {
          nodes: [
            ...fullSet(after, { [outline.id]: { name: '多余节点' } }),
            {
              nodeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              expectedUpdatedAt: after.nodes[0]!.updatedAt,
              name: '幽灵',
            },
          ],
        }),
        409,
      ),
    );
    expect(extra.code).toBe('constraint_violation');
  }, 30_000);

  test('archived and closed projects refuse layout writes', async () => {
    const ctx = await ready(sql, app);
    if (!ctx) return;
    const graph = await reload(ctx);
    const outline = nodeOf(graph, '大纲');

    await ctx.sql`
      UPDATE commercial_projects
      SET archived_at = now(), overall_stage = 'archived', updated_at = now()
      WHERE id = ${ctx.projectId}
    `;
    const archived = parseCommercialWriteError(
      await expectJson(
        await patchLayout(ctx, {
          nodes: fullSet(graph, { [outline.id]: { name: '归档改名' } }),
        }),
        409,
      ),
    );
    expect(archived.code).toBe('invalid_transition');
    expect(archived.error).toContain('归档');

    await ctx.sql`
      UPDATE commercial_projects
      SET archived_at = NULL, business_closed_at = now(), overall_stage = 'closed', updated_at = now()
      WHERE id = ${ctx.projectId}
    `;
    const closed = parseCommercialWriteError(
      await expectJson(
        await patchLayout(ctx, {
          nodes: fullSet(graph, { [outline.id]: { name: '结案改名' } }),
        }),
        409,
      ),
    );
    expect(closed.code).toBe('invalid_transition');
    expect(closed.error).toContain('结案');
  }, 30_000);
});

async function ready(
  sql: Sql | null,
  app: App | null,
): Promise<{ sql: Sql; app: App; projectId: string } | null> {
  if (!sql || !app) return null;
  const projectId = await createProject(sql, `layout-${crypto.randomUUID()}`);
  return { sql, app, projectId };
}

async function reload(ctx: { app: App; projectId: string }): Promise<CommercialProjectWorkflow> {
  const res = await ctx.app.request(`/api/v1/commercial/projects/${ctx.projectId}/workflow`);
  expect(res.status).toBe(200);
  return parseCommercialProjectWorkflow(await res.json());
}

function nodeOf(graph: CommercialProjectWorkflow, name: string) {
  const node = graph.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`missing ${name}`);
  return node;
}

function fullSet(
  graph: CommercialProjectWorkflow,
  patches: Record<string, { name?: string; posX?: number; posY?: number }>,
) {
  return graph.nodes.map((node) => {
    const patch = patches[node.id] ?? {};
    return {
      nodeId: node.id,
      expectedUpdatedAt: node.updatedAt,
      ...patch,
    };
  });
}

async function patchLayout(ctx: { app: App; projectId: string }, body: unknown): Promise<Response> {
  return ctx.app.request(`/api/v1/commercial/projects/${ctx.projectId}/workflow/layout`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function expectJson(res: Response, status: number): Promise<unknown> {
  const payload: unknown = await res.json();
  expect(res.status, JSON.stringify(payload)).toBe(status);
  return payload;
}

async function createProject(db: Sql, name: string): Promise<string> {
  const projectId = crypto.randomUUID();
  const workflowId = crypto.randomUUID();
  await db`INSERT INTO commercial_projects (id, name) VALUES (${projectId}, ${name})`;
  await db`
    INSERT INTO project_workflows (id, project_id, template_version_id)
    VALUES (${workflowId}, ${projectId}, ${DEFAULT_TEMPLATE})
  `;
  const packages = await db<{ id: string; name: string; sort_order: number }[]>`
    SELECT id, name, sort_order FROM wf_template_packages WHERE template_version_id = ${DEFAULT_TEMPLATE}
  `;
  const packageMap = new Map<string, string>();
  for (const pkg of packages) {
    const id = crypto.randomUUID();
    packageMap.set(pkg.id, id);
    await db`
      INSERT INTO wf_packages (id, workflow_id, name, sort_order)
      VALUES (${id}, ${workflowId}, ${pkg.name}, ${pkg.sort_order})
    `;
  }
  const nodes = await db<
    {
      id: string;
      name: string;
      kind: string;
      phase: string;
      is_optional: boolean;
      pos_x: number;
      pos_y: number;
      package_id: string | null;
    }[]
  >`
    SELECT id, name, kind, phase, is_optional, pos_x, pos_y, package_id
    FROM wf_template_nodes WHERE template_version_id = ${DEFAULT_TEMPLATE}
  `;
  const nodeMap = new Map<string, string>();
  for (const node of nodes) {
    const id = crypto.randomUUID();
    nodeMap.set(node.id, id);
    const packageId = node.package_id ? (packageMap.get(node.package_id) ?? null) : null;
    await db`
      INSERT INTO wf_nodes (
        id, workflow_id, project_id, template_version_id, template_node_id, package_id,
        name, kind, phase, status, is_optional, pos_x, pos_y, source
      ) VALUES (
        ${id}, ${workflowId}, ${projectId}, ${DEFAULT_TEMPLATE}, ${node.id}, ${packageId},
        ${node.name}, ${node.kind}, ${node.phase}, 'not_reached', ${node.is_optional},
        ${node.pos_x}, ${node.pos_y}, 'template'
      )
    `;
  }
  const edges = await db<{ from_node_id: string; to_node_id: string }[]>`
    SELECT from_node_id, to_node_id FROM wf_template_edges WHERE template_version_id = ${DEFAULT_TEMPLATE}
  `;
  for (const edge of edges) {
    const fromId = nodeMap.get(edge.from_node_id);
    const toId = nodeMap.get(edge.to_node_id);
    if (!fromId || !toId) throw new Error('template edge endpoint missing');
    await db`
      INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
      VALUES (${crypto.randomUUID()}, ${workflowId}, ${fromId}, ${toId})
    `;
  }
  return projectId;
}
