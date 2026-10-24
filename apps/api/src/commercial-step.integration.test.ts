import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  parseCommercialProjectWorkflow,
  parseCommercialStepResponse,
  parseCommercialWriteError,
  type CommercialProjectWorkflow,
  type CommercialWriteErrorBody,
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

describe('commercial stepwise progress', () => {
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

  test('node steps close ancestors, spare siblings, and roll back one persisted step', async () => {
    const ctx = await ready(sql, app);
    if (!ctx) return;
    const copy = await stepNode(ctx, '文案', 'forward');
    expect(copy.nodes.find((node) => node.name === '文案')?.status).toBe('in_progress');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      inquiry: 'completed',
      outline: 'completed',
      copy: 'in_progress',
      pre_shoot: 'not_reached',
      merge: 'not_reached',
      a_roll: 'not_reached',
    });
    const completedAt = await completedAtOf(ctx.sql, ctx.projectId, '大纲');
    expect(completedAt).not.toBeNull();
    expect(await completedAtOf(ctx.sql, ctx.projectId, 'copy')).toBeNull();

    await stepNode(ctx, '文案', 'forward');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      copy: 'completed',
      pre_shoot: 'not_reached',
    });
    const again = await stepNode(ctx, '文案', 'forward', {}, 409);
    expect(again.code).toBe('invalid_transition');
    expect(await statuses(ctx.sql, ctx.projectId).then((rows) => rows.pre_shoot)).toBe(
      'not_reached',
    );

    await stepNode(ctx, '预拍摄', 'forward');
    expect((await statuses(ctx.sql, ctx.projectId)).pre_shoot).toBe('in_progress');
    const outlineStill = await completedAtOf(ctx.sql, ctx.projectId, '大纲');
    expect(outlineStill?.toISOString()).toBe(completedAt?.toISOString());

    const graph = await reload(ctx);
    const copyId = idOf(graph, '文案');
    const planned = await ctx.app.request(
      `/api/v1/commercial/projects/${ctx.projectId}/nodes/${copyId}/plan`,
      json({ expectedUpdatedAt: tokenOf(graph, '文案'), plannedAt: '2026-04-09' }),
    );
    expect(planned.status).toBe(200);
    await stepNode(ctx, '文案', 'rollback');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      copy: 'in_progress',
      pre_shoot: 'in_progress',
      outline: 'completed',
    });
    expect(await completedAtOf(ctx.sql, ctx.projectId, 'copy')).toBeNull();
    expect(await plannedDay(ctx.sql, ctx.projectId, '文案')).toBe('2026-04-09');

    await stepNode(ctx, '文案', 'rollback');
    expect((await statuses(ctx.sql, ctx.projectId)).copy).toBe('not_reached');
    expect(await plannedDay(ctx.sql, ctx.projectId, '文案')).toBe('2026-04-09');
    expect((await statuses(ctx.sql, ctx.projectId)).outline).toBe('completed');
  }, 30_000);

  test('stage advance, complete, and rollback follow the frontier and stop at stage edges', async () => {
    const ctx = await ready(sql, app);
    if (!ctx) return;
    const advanced = await stepStage(ctx, 'production', 'forward');
    expect(advanced.nodes.map((node) => `${node.name}:${node.status}`).sort()).toEqual(
      [
        'AI 后期:in_progress',
        'A-roll 拍摄:in_progress',
        'B-roll 素材:in_progress',
        '文案:completed',
        '汇合节点:completed',
        '大纲:completed',
        '询单:completed',
        '预拍摄:completed',
      ].sort(),
    );
    expect((await statuses(ctx.sql, ctx.projectId)).review).toBe('not_reached');

    await stepNode(ctx, 'A-roll 拍摄', 'forward');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      a_roll: 'completed',
      b_roll: 'in_progress',
      ai_post: 'in_progress',
      review: 'not_reached',
    });

    await stepNode(ctx, 'A-roll 拍摄', 'rollback');
    expect((await statuses(ctx.sql, ctx.projectId)).a_roll).toBe('in_progress');

    await stepStage(ctx, 'production', 'forward');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      a_roll: 'completed',
      b_roll: 'completed',
      ai_post: 'completed',
      review: 'not_reached',
    });

    await stepStage(ctx, 'production', 'rollback');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      a_roll: 'in_progress',
      b_roll: 'in_progress',
      ai_post: 'in_progress',
      merge: 'completed',
      review: 'not_reached',
    });

    await stepStage(ctx, 'production', 'rollback');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      a_roll: 'not_reached',
      b_roll: 'not_reached',
      ai_post: 'not_reached',
      merge: 'completed',
      copy: 'completed',
    });
  }, 30_000);

  test('open blocks need confirmation, and cancel writes nothing', async () => {
    const ctx = await ready(sql, app);
    if (!ctx) return;
    await stepNode(ctx, '文案', 'forward');
    const blocked = await postAction(ctx, '文案', 'block', { reason: '等甲方' });
    expect(blocked.status).toBe(200);
    const before = await snapshot(ctx.sql, ctx.projectId);
    const refused = await stepNode(ctx, '文案', 'forward', {}, 409);
    expect(refused.code).toBe('confirmation_required');
    expect(refused.blocks?.[0]?.nodeName).toBe('文案');
    expect(refused.blocks?.[0]?.reason).toBe('等甲方');
    expect(await snapshot(ctx.sql, ctx.projectId)).toEqual(before);

    const restored = await stepNode(ctx, '文案', 'forward', { force: true });
    expect(restored.nodes.find((node) => node.name === '文案')?.status).toBe('in_progress');
    expect(await openBlockingTitles(ctx.sql, ctx.projectId)).toEqual([]);
    await stepNode(ctx, '文案', 'forward');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      copy: 'completed',
      pre_shoot: 'not_reached',
    });
  }, 30_000);

  test('a blocked stage completes only its members after an explicit force', async () => {
    const ctx = await ready(sql, app);
    if (!ctx) return;
    await stepNode(ctx, '文案', 'forward');
    await stepNode(ctx, '预拍摄', 'forward');
    const blocked = await postAction(ctx, '文案', 'block', { reason: '文案未过' });
    expect(blocked.status).toBe(200);
    const before = await snapshot(ctx.sql, ctx.projectId);
    const refused = await stepStage(ctx, 'copy_prep', 'forward', {}, 409);
    expect(refused.code).toBe('confirmation_required');
    expect(refused.names).toEqual(['文案']);
    expect(await snapshot(ctx.sql, ctx.projectId)).toEqual(before);

    await stepStage(ctx, 'copy_prep', 'forward', { force: true });
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      copy: 'completed',
      pre_shoot: 'completed',
      a_roll: 'not_reached',
      merge: 'not_reached',
    });
    expect(await openBlockingTitles(ctx.sql, ctx.projectId)).toEqual([]);
  }, 30_000);

  test('publish is one transaction, and a later conflict rolls the whole step back', async () => {
    const ctx = await ready(sql, app);
    if (!ctx) return;
    await markCompleted(ctx.sql, ctx.projectId, [
      '询单',
      '大纲',
      '文案',
      '预拍摄',
      '汇合节点',
      'A-roll 拍摄',
      'B-roll 素材',
      'AI 后期',
    ]);
    await markStatus(ctx.sql, ctx.projectId, '审核', 'in_progress');
    const missing = await stepStage(ctx, 'client_review', 'forward', {}, 409);
    expect(missing.code).toBe('publish_required');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      review: 'in_progress',
      publish: 'not_reached',
    });
    expect(await publishCount(ctx.sql, ctx.projectId)).toBe(0);

    const other = await createProject(ctx.sql, '其他项目');
    await ctx.sql`
      INSERT INTO project_publish_records (project_id, bvid, published_at, publish_source, idempotency_key)
      VALUES (${other}, 'BV1xx411c7mD', now(), 'web', 'step-conflict-key')
    `;
    const conflict = await stepStage(
      ctx,
      'client_review',
      'forward',
      { publish: publishBody('step-conflict-key') },
      409,
    );
    expect(conflict.code).toBe('publish_conflict');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      review: 'in_progress',
      publish: 'not_reached',
    });
    expect(await publishCount(ctx.sql, ctx.projectId)).toBe(0);

    const done = await stepStage(ctx, 'client_review', 'forward', {
      publish: publishBody('step-ok-key', '2026-04-02T03:04:05.000Z'),
    });
    expect(done.overallStage).toBe('published_winding_down');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      review: 'completed',
      publish: 'completed',
      settlement: 'not_reached',
    });
    expect(await publishCount(ctx.sql, ctx.projectId)).toBe(1);
    expect(await jobCount(ctx.sql, ctx.projectId)).toBe(2);
    const repeat = await stepStage(
      ctx,
      'client_review',
      'forward',
      { publish: publishBody('step-ok-key-2') },
      409,
    );
    expect(repeat.code).toBe('invalid_transition');
    expect(await publishCount(ctx.sql, ctx.projectId)).toBe(1);

    await stepStage(ctx, 'distribution_settlement', 'forward');
    expect((await statuses(ctx.sql, ctx.projectId)).settlement).toBe('in_progress');
    const refused = await stepStage(ctx, 'client_review', 'rollback', {}, 409);
    expect(refused.code).toBe('successors_advanced');
    expect(refused.successors?.map((item) => item.nodeName)).toContain('结算');
    expect((await statuses(ctx.sql, ctx.projectId)).publish).toBe('completed');
  }, 30_000);

  test('a stale token and an archived project write nothing', async () => {
    const ctx = await ready(sql, app);
    if (!ctx) return;
    const graph = await reload(ctx);
    const stale = await ctx.app.request(
      `/api/v1/commercial/projects/${ctx.projectId}/nodes/${idOf(graph, '询单')}/step`,
      json({
        expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
        direction: 'forward',
      }),
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe('stale_write');
    expect((await statuses(ctx.sql, ctx.projectId)).inquiry).toBe('not_reached');

    await ctx.sql`
      UPDATE commercial_projects
      SET overall_stage = 'archived', archived_at = now()
      WHERE id = ${ctx.projectId}
    `;
    const archived = await stepNode(ctx, '询单', 'forward', {}, 409);
    expect(archived.error).toContain('归档');
    expect((await statuses(ctx.sql, ctx.projectId)).inquiry).toBe('not_reached');
  }, 30_000);

  test('skipping the merge keeps it not_applicable while A-roll still closes 文案 and 预拍摄', async () => {
    const ctx = await ready(sql, app);
    if (!ctx) return;
    await stepNode(ctx, '文案', 'forward');
    await stepNode(ctx, '文案', 'forward');
    await stepNode(ctx, '预拍摄', 'forward');
    await stepNode(ctx, '预拍摄', 'forward');
    const skipped = await postAction(ctx, '汇合节点', 'skip');
    expect(skipped.status).toBe(200);
    await stepNode(ctx, 'A-roll 拍摄', 'forward');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      merge: 'not_applicable',
      a_roll: 'in_progress',
      b_roll: 'not_reached',
      copy: 'completed',
      pre_shoot: 'completed',
    });
  }, 30_000);

  test('an in-progress node with an open blocking item confirms before it can be completed', async () => {
    const ctx = await ready(sql, app);
    if (!ctx) return;
    await stepNode(ctx, '文案', 'forward');
    const graph = await reload(ctx);
    const copyId = idOf(graph, '文案');
    const itemId = crypto.randomUUID();
    await ctx.sql`
      INSERT INTO open_items (
        id, project_id, workflow_node_id, blocks_node_id, title, impact, lifecycle, next_actor
      ) VALUES (
        ${itemId}, ${ctx.projectId}, ${copyId}, ${copyId}, '文案仍挂着开放阻塞', 'blocking', 'open', 'us'
      )
    `;
    await ctx.sql`
      UPDATE wf_nodes
      SET primary_block_pinned_item_id = ${itemId}, updated_at = now()
      WHERE id = ${copyId}
    `;
    const before = await snapshot(ctx.sql, ctx.projectId);
    const refused = await stepNode(ctx, '文案', 'forward', {}, 409);
    expect(refused.code).toBe('confirmation_required');
    expect(refused.blocks?.[0]?.itemId).toBe(itemId);
    expect(await snapshot(ctx.sql, ctx.projectId)).toEqual(before);

    await stepNode(ctx, '文案', 'forward', { force: true });
    expect((await statuses(ctx.sql, ctx.projectId)).copy).toBe('completed');
    expect(await openBlockingTitles(ctx.sql, ctx.projectId)).toEqual([]);
  }, 30_000);

  test('rolling publish back can complete again with the stored key and not a new one', async () => {
    const ctx = await ready(sql, app);
    if (!ctx) return;
    await markCompleted(ctx.sql, ctx.projectId, [
      '询单',
      '大纲',
      '文案',
      '预拍摄',
      '汇合节点',
      'A-roll 拍摄',
      'B-roll 素材',
      'AI 后期',
      '审核',
    ]);
    await markStatus(ctx.sql, ctx.projectId, '发布', 'in_progress');
    await stepNode(ctx, '发布', 'forward', {
      publish: publishBody('replay-key', '2026-04-02T03:04:05.000Z'),
    });
    expect((await statuses(ctx.sql, ctx.projectId)).publish).toBe('completed');
    expect(await publishCount(ctx.sql, ctx.projectId)).toBe(1);
    expect(await jobCount(ctx.sql, ctx.projectId)).toBe(2);
    const detail = await ctx.app.request(`/api/v1/commercial/projects/${ctx.projectId}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { publish: { idempotencyKey: string; bvid: string } };
    expect(body.publish.idempotencyKey).toBe('replay-key');
    expect(body.publish.bvid).toBe('BV1xx411c7mD');

    await stepNode(ctx, '发布', 'rollback');
    expect((await statuses(ctx.sql, ctx.projectId)).publish).toBe('in_progress');
    const conflict = await stepNode(
      ctx,
      '发布',
      'forward',
      { publish: publishBody('replay-key-new') },
      409,
    );
    expect(conflict.code).toBe('publish_conflict');
    expect((await statuses(ctx.sql, ctx.projectId)).publish).toBe('in_progress');
    expect(await jobCount(ctx.sql, ctx.projectId)).toBe(2);

    await stepNode(ctx, '发布', 'forward', { publish: publishBody('replay-key') });
    expect((await statuses(ctx.sql, ctx.projectId)).publish).toBe('completed');
    expect(await publishCount(ctx.sql, ctx.projectId)).toBe(1);
    expect(await jobCount(ctx.sql, ctx.projectId)).toBe(2);
    const repeat = await stepNode(
      ctx,
      '发布',
      'forward',
      { publish: publishBody('replay-key') },
      409,
    );
    expect(repeat.code).toBe('invalid_transition');
    expect(await jobCount(ctx.sql, ctx.projectId)).toBe(2);
  }, 30_000);

  test('rolling the review stage back reuses the same publish record for the stage', async () => {
    const ctx = await ready(sql, app);
    if (!ctx) return;
    await markCompleted(ctx.sql, ctx.projectId, [
      '询单',
      '大纲',
      '文案',
      '预拍摄',
      '汇合节点',
      'A-roll 拍摄',
      'B-roll 素材',
      'AI 后期',
    ]);
    await markStatus(ctx.sql, ctx.projectId, '审核', 'in_progress');
    await stepStage(ctx, 'client_review', 'forward', { publish: publishBody('stage-replay-key') });
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      review: 'completed',
      publish: 'completed',
    });
    expect(await jobCount(ctx.sql, ctx.projectId)).toBe(2);

    await stepStage(ctx, 'client_review', 'rollback');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      review: 'completed',
      publish: 'in_progress',
    });
    const conflict = await stepStage(
      ctx,
      'client_review',
      'forward',
      { publish: publishBody('stage-replay-key-new') },
      409,
    );
    expect(conflict.code).toBe('publish_conflict');
    expect(await statuses(ctx.sql, ctx.projectId)).toMatchObject({
      review: 'completed',
      publish: 'in_progress',
    });
    expect(await publishCount(ctx.sql, ctx.projectId)).toBe(1);
    expect(await jobCount(ctx.sql, ctx.projectId)).toBe(2);

    await stepStage(ctx, 'client_review', 'forward', { publish: publishBody('stage-replay-key') });
    expect((await statuses(ctx.sql, ctx.projectId)).publish).toBe('completed');
    expect(await jobCount(ctx.sql, ctx.projectId)).toBe(2);
    const repeat = await stepStage(
      ctx,
      'client_review',
      'forward',
      { publish: publishBody('stage-replay-key') },
      409,
    );
    expect(repeat.code).toBe('invalid_transition');
    expect(await jobCount(ctx.sql, ctx.projectId)).toBe(2);
  }, 30_000);
});

function publishBody(idempotencyKey: string, publishedAt?: string) {
  return {
    idempotencyKey,
    platform: 'bilibili',
    bvid: 'BV1xx411c7mD',
    ...(publishedAt ? { publishedAt } : {}),
  };
}

async function ready(sql: Sql | null, app: App | null) {
  if (!sql || !app) return null;
  const projectId = await createProject(sql, `step ${crypto.randomUUID()}`);
  return { sql, app, projectId };
}

async function reload(ctx: { app: App; projectId: string }): Promise<CommercialProjectWorkflow> {
  const res = await ctx.app.request(`/api/v1/commercial/projects/${ctx.projectId}/workflow`);
  expect(res.status).toBe(200);
  return parseCommercialProjectWorkflow(await res.json());
}

function idOf(graph: CommercialProjectWorkflow, name: string): string {
  const node = graph.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`missing ${name}`);
  return node.id;
}

function tokenOf(graph: CommercialProjectWorkflow, name: string): string {
  const node = graph.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`missing ${name}`);
  return node.updatedAt;
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function stepNode(
  ctx: { app: App; projectId: string },
  name: string,
  direction: 'forward' | 'rollback',
  extra?: Record<string, unknown>,
): Promise<ReturnType<typeof parseCommercialStepResponse>>;
async function stepNode(
  ctx: { app: App; projectId: string },
  name: string,
  direction: 'forward' | 'rollback',
  extra: Record<string, unknown>,
  status: number,
): Promise<CommercialWriteErrorBody>;
async function stepNode(
  ctx: { app: App; projectId: string },
  name: string,
  direction: 'forward' | 'rollback',
  extra: Record<string, unknown> = {},
  status = 200,
): Promise<ReturnType<typeof parseCommercialStepResponse> | CommercialWriteErrorBody> {
  const graph = await reload(ctx);
  const res = await ctx.app.request(
    `/api/v1/commercial/projects/${ctx.projectId}/nodes/${idOf(graph, name)}/step`,
    json({ expectedUpdatedAt: tokenOf(graph, name), direction, ...extra }),
  );
  const payload: unknown = await res.json();
  if (status === 200) {
    expect(res.status, JSON.stringify(payload)).toBe(200);
    return parseCommercialStepResponse(payload);
  }
  expect(res.status, JSON.stringify(payload)).toBe(status);
  return parseCommercialWriteError(payload);
}

async function stepStage(
  ctx: { app: App; projectId: string },
  stageId: string,
  direction: 'forward' | 'rollback',
  extra?: Record<string, unknown>,
): Promise<ReturnType<typeof parseCommercialStepResponse>>;
async function stepStage(
  ctx: { app: App; projectId: string },
  stageId: string,
  direction: 'forward' | 'rollback',
  extra: Record<string, unknown>,
  status: number,
): Promise<CommercialWriteErrorBody>;
async function stepStage(
  ctx: { app: App; projectId: string },
  stageId: string,
  direction: 'forward' | 'rollback',
  extra: Record<string, unknown> = {},
  status = 200,
): Promise<ReturnType<typeof parseCommercialStepResponse> | CommercialWriteErrorBody> {
  const graph = await reload(ctx);
  const slugs = stageSlugs(stageId);
  const tokens = graph.nodes
    .filter((node) => node.templateSlug && slugs.has(node.templateSlug) && node.kind !== 'merge')
    .map((node) => ({ nodeId: node.id, expectedUpdatedAt: node.updatedAt }));
  const res = await ctx.app.request(
    `/api/v1/commercial/projects/${ctx.projectId}/stages/${stageId}/step`,
    json({ direction, tokens, ...extra }),
  );
  const payload: unknown = await res.json();
  if (status === 200) {
    expect(res.status, JSON.stringify(payload)).toBe(200);
    return parseCommercialStepResponse(payload);
  }
  expect(res.status, JSON.stringify(payload)).toBe(status);
  return parseCommercialWriteError(payload);
}

function stageSlugs(stageId: string): Set<string> {
  const map: Record<string, string[]> = {
    write_outline: ['outline'],
    copy_prep: ['copy', 'pre_shoot', 'manual'],
    production: ['a_roll', 'b_roll', 'ai_post'],
    client_review: ['review', 'publish'],
    distribution_settlement: ['distribution', 'settlement', 'data_maint', 'other'],
  };
  return new Set(map[stageId] ?? []);
}

async function postAction(
  ctx: { app: App; projectId: string },
  name: string,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  const graph = await reload(ctx);
  return ctx.app.request(
    `/api/v1/commercial/projects/${ctx.projectId}/nodes/${idOf(graph, name)}/${action}`,
    json({ expectedUpdatedAt: tokenOf(graph, name), ...extra }),
  );
}

async function statuses(sql: Sql, projectId: string): Promise<Record<string, string>> {
  const rows = await sql<{ slug: string; status: string }[]>`
    SELECT t.slug, n.status
    FROM wf_nodes n
    JOIN wf_template_nodes t
      ON t.id = n.template_node_id
     AND t.template_version_id = n.template_version_id
    WHERE n.project_id = ${projectId}
  `;
  return Object.fromEntries(rows.map((row) => [row.slug, row.status]));
}

async function snapshot(sql: Sql, projectId: string): Promise<string[]> {
  const rows = await sql<{ slug: string; status: string; items: string }[]>`
    SELECT t.slug, n.status,
      (
        SELECT count(*)::text FROM open_items oi
        WHERE oi.project_id = n.project_id AND oi.lifecycle = 'open' AND oi.impact = 'blocking'
          AND (oi.blocks_node_id = n.id OR oi.id = n.primary_block_pinned_item_id)
      ) AS items
    FROM wf_nodes n
    JOIN wf_template_nodes t
      ON t.id = n.template_node_id AND t.template_version_id = n.template_version_id
    WHERE n.project_id = ${projectId}
    ORDER BY t.slug
  `;
  return rows.map((row) => `${row.slug}:${row.status}:${row.items}`);
}

async function completedAtOf(sql: Sql, projectId: string, name: string): Promise<Date | null> {
  const [row] = await sql<{ completed_at: Date | null }[]>`
    SELECT completed_at FROM wf_nodes WHERE project_id = ${projectId} AND name = ${name}
  `;
  return row?.completed_at ?? null;
}

async function plannedDay(sql: Sql, projectId: string, name: string): Promise<string | null> {
  const [row] = await sql<{ day: string | null }[]>`
    SELECT to_char(planned_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day
    FROM wf_nodes WHERE project_id = ${projectId} AND name = ${name}
  `;
  return row?.day ?? null;
}

async function openBlockingTitles(sql: Sql, projectId: string): Promise<string[]> {
  const rows = await sql<{ title: string }[]>`
    SELECT title FROM open_items
    WHERE project_id = ${projectId} AND lifecycle = 'open' AND impact = 'blocking'
    ORDER BY title
  `;
  return rows.map((row) => row.title);
}

async function publishCount(sql: Sql, projectId: string): Promise<number> {
  const [row] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM project_publish_records WHERE project_id = ${projectId}
  `;
  return Number(row?.c ?? 0);
}

async function jobCount(sql: Sql, projectId: string): Promise<number> {
  const [row] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM monitor_jobs WHERE project_id = ${projectId}
  `;
  return Number(row?.c ?? 0);
}

async function markCompleted(sql: Sql, projectId: string, names: string[]): Promise<void> {
  await sql`
    UPDATE wf_nodes
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE project_id = ${projectId} AND name = ANY(${names})
  `;
}

async function markStatus(
  sql: Sql,
  projectId: string,
  name: string,
  status: string,
): Promise<void> {
  await sql`
    UPDATE wf_nodes
    SET status = ${status}, updated_at = now()
    WHERE project_id = ${projectId} AND name = ${name}
  `;
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
