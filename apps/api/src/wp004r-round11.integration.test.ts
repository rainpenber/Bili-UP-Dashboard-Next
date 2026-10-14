import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  seedCommercialFixtures,
} from '@studio/db';
import type { createSql } from '@studio/db';
import { openItemHistoryEntrySchema } from '@studio/contracts';
import { createApp } from './app';
import { createCommercialRoutes } from './commercial-routes';

async function createProject(app: ReturnType<typeof createApp>, name: string) {
  const createRes = await app.request('/api/v1/commercial/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  expect(createRes.status).toBe(201);
  return createRes.json() as Promise<{ id: string }>;
}

describe('WP-004R round11 integration', () => {
  let sql: ReturnType<typeof createSql> | null = null;
  let isolatedDbName: string | null = null;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    sql = isolated.sql;
    isolatedDbName = isolated.databaseName;
    await seedCommercialFixtures(sql);
    app = createApp({ skipDb: true });
    app.route('/api/v1/commercial', createCommercialRoutes(sql));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (isolatedDbName) await dropIsolatedTestDatabase(isolatedDbName);
  });

  test('open item history returns object detail for create close cancel update', async () => {
    if (!sql) return;
    const project = await createProject(app, 'r11-history');
    const createRes = await app.request(`/api/v1/commercial/projects/${project.id}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '历史项', nextActor: 'us' }),
    });
    expect(createRes.status).toBe(201);
    const item = (await createRes.json()) as { id: string };

    await app.request(`/api/v1/commercial/projects/${project.id}/open-items/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nextAction: '跟进' }),
    });

    const item2Res = await app.request(`/api/v1/commercial/projects/${project.id}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '取消项', nextActor: 'us' }),
    });
    const item2 = (await item2Res.json()) as { id: string };
    await app.request(`/api/v1/commercial/projects/${project.id}/open-items/${item2.id}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '不再需要' }),
    });

    await app.request(`/api/v1/commercial/projects/${project.id}/open-items/${item.id}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conclusion: '完成' }),
    });

    const histRes = await app.request(
      `/api/v1/commercial/projects/${project.id}/open-items/${item.id}/history`,
    );
    expect(histRes.status).toBe(200);
    const body = (await histRes.json()) as { items: unknown[] };
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    for (const entry of body.items) {
      const parsed = openItemHistoryEntrySchema.parse(entry);
      if (parsed.detail != null) {
        expect(typeof parsed.detail).toBe('object');
        expect(Array.isArray(parsed.detail)).toBe(false);
      }
    }
    const actions = body.items.map((e) => openItemHistoryEntrySchema.parse(e).action);
    expect(actions).toContain('create');
    expect(actions).toContain('update');
    expect(actions).toContain('close');
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('deleting pinned open item clears pin and keeps node project_id', async () => {
    if (!sql) return;
    const project = await createProject(app, 'r11-pin-delete');
    const wf = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const outline = wf.nodes.find((n: { slug: string | null }) => n.slug === 'outline');
    const itemRes = await app.request(`/api/v1/commercial/projects/${project.id}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Pin 删除',
        nextActor: 'us',
        impact: 'blocking',
        blocksNodeId: outline.id,
      }),
    });
    const item = (await itemRes.json()) as { id: string };
    await app.request(
      `/api/v1/commercial/projects/${project.id}/open-items/${item.id}/pin-primary-block`,
      { method: 'POST' },
    );
    const before = await sql<{ project_id: string; primary_block_pinned_item_id: string | null }[]>`
      SELECT project_id, primary_block_pinned_item_id FROM wf_nodes WHERE id = ${outline.id}
    `;
    expect(before[0]?.primary_block_pinned_item_id).toBe(item.id);
    await sql`DELETE FROM open_items WHERE id = ${item.id}`;
    const after = await sql<{ project_id: string; primary_block_pinned_item_id: string | null }[]>`
      SELECT project_id, primary_block_pinned_item_id FROM wf_nodes WHERE id = ${outline.id}
    `;
    expect(after[0]?.project_id).toBe(before[0]?.project_id);
    expect(after[0]?.primary_block_pinned_item_id).toBeNull();
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('reset without confirm returns 409 when custom nodes already exist', async () => {
    if (!sql) return;
    const project = await createProject(app, 'r11-reset-409');
    await app.request(`/api/v1/commercial/projects/${project.id}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '已有自定义', posX: 10, posY: 10 }),
    });
    const reset = await app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `r11-reset-409-${project.id}`,
        operation: 'reset_project_workflow',
        confidence: 1,
        autoApply: true,
        payload: {
          projectId: project.id,
          templateVersionId: (
            await sql<{ template_version_id: string }[]>`
              SELECT template_version_id FROM project_workflows WHERE project_id = ${project.id}
            `
          )[0]!.template_version_id,
          confirmDestroyCustomGraph: false,
        },
      }),
    });
    expect(reset.status).toBe(409);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('reset without confirm cannot observe stale zero custom count under workflow lock', async () => {
    if (!sql) return;
    const project = await createProject(app, 'r11-reset-lock');
    await app.request(`/api/v1/commercial/projects/${project.id}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '锁内自定义', posX: 10, posY: 10 }),
    });
    const insertBlocked = (async () => {
      return app.request(`/api/v1/commercial/projects/${project.id}/nodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '锁等待节点', posX: 20, posY: 20 }),
      });
    })();
    await new Promise((r) => setTimeout(r, 30));
    const resetDuringLock = await sql.begin(async (tx) => {
      await tx`SELECT id FROM project_workflows WHERE project_id = ${project.id} FOR UPDATE`;
      const resetRes = await app.request('/api/v1/commercial/hermes/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: `r11-lock-reset-${project.id}`,
          operation: 'reset_project_workflow',
          confidence: 1,
          autoApply: true,
          payload: {
            projectId: project.id,
            templateVersionId: (
              await tx<{ template_version_id: string }[]>`
                SELECT template_version_id FROM project_workflows WHERE project_id = ${project.id}
              `
            )[0]!.template_version_id,
            confirmDestroyCustomGraph: false,
          },
        }),
      });
      return resetRes.status;
    });
    const insertRes = await insertBlocked;
    expect(resetDuringLock).toBe(409);
    expect(insertRes.status).toBeLessThan(500);
    const custom = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_nodes
      WHERE project_id = ${project.id} AND source <> 'template'
    `;
    expect(Number(custom[0]?.c ?? '0')).toBeGreaterThan(0);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('publish result exposes monitor job types', async () => {
    if (!sql) return;
    const project = await createProject(app, 'r11-pub-jobs');
    const bvid = `BV11${Date.now()}`;
    const res = await app.request(`/api/v1/commercial/projects/${project.id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bvid,
        publishedAt: '2026-06-02T10:00:00.000Z',
        idempotencyKey: `r11-pub-${project.id}`,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { monitorJobTypes?: string[] };
    expect(body.monitorJobTypes?.sort()).toEqual(['metadata', 'metrics']);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });
});
