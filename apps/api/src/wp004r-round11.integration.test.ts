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

  async function templateVersionIdFor(projectId: string) {
    const rows = await sql!<{ template_version_id: string }[]>`
      SELECT template_version_id FROM project_workflows WHERE project_id = ${projectId}
    `;
    return rows[0]!.template_version_id;
  }

  test('reset without confirm races concurrent custom node insert — custom survives', async () => {
    if (!sql) return;
    const project = await createProject(app, 'r11-reset-race');
    const templateVersionId = await templateVersionIdFor(project.id);
    const insertDuringReset = app.request(`/api/v1/commercial/projects/${project.id}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '并发插入', posX: 30, posY: 30 }),
    });
    const resetDuringInsert = app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `r11-reset-race-${project.id}`,
        operation: 'reset_project_workflow',
        confidence: 1,
        autoApply: true,
        payload: {
          projectId: project.id,
          templateVersionId,
          confirmDestroyCustomGraph: false,
        },
      }),
    });
    const [insertRes, resetRes] = await Promise.all([insertDuringReset, resetDuringInsert]);
    expect(insertRes.status).toBeLessThan(500);
    expect(resetRes.status).toBeLessThan(500);
    const custom = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_nodes
      WHERE project_id = ${project.id} AND source <> 'template'
    `;
    expect(Number(custom[0]?.c ?? '0')).toBeGreaterThanOrEqual(1);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('reset without confirm returns 409 when custom exists even if another insert races', async () => {
    if (!sql) return;
    const project = await createProject(app, 'r11-reset-race409');
    await app.request(`/api/v1/commercial/projects/${project.id}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '已有自定义', posX: 10, posY: 10 }),
    });
    const templateVersionId = await templateVersionIdFor(project.id);
    const [insertRes, resetRes] = await Promise.all([
      app.request(`/api/v1/commercial/projects/${project.id}/nodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '并发第二条', posX: 40, posY: 40 }),
      }),
      app.request('/api/v1/commercial/hermes/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: `r11-reset-race409-${project.id}`,
          operation: 'reset_project_workflow',
          confidence: 1,
          autoApply: true,
          payload: {
            projectId: project.id,
            templateVersionId,
            confirmDestroyCustomGraph: false,
          },
        }),
      }),
    ]);
    expect(resetRes.status).toBe(409);
    expect(insertRes.status).toBeLessThan(500);
    const custom = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_nodes
      WHERE project_id = ${project.id} AND source <> 'template'
    `;
    expect(Number(custom[0]?.c ?? '0')).toBeGreaterThanOrEqual(2);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('migration 013 cleanup clears cross-project primary pin dirty rows', async () => {
    if (!sql) return;
    const projectA = await createProject(app, 'r11-pin-clean-a');
    const projectB = await createProject(app, 'r11-pin-clean-b');
    const wfA = await (
      await app.request(`/api/v1/commercial/projects/${projectA.id}/workflow`)
    ).json();
    const outlineA = wfA.nodes.find((n: { slug: string | null }) => n.slug === 'outline');
    const itemBRes = await app.request(`/api/v1/commercial/projects/${projectB.id}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '跨项目脏 pin', nextActor: 'us' }),
    });
    const itemB = (await itemBRes.json()) as { id: string };
    await sql`ALTER TABLE wf_nodes DROP CONSTRAINT IF EXISTS fk_wf_nodes_primary_block_item_project`;
    await sql`
      UPDATE wf_nodes SET primary_block_pinned_item_id = ${itemB.id}
      WHERE id = ${outlineA.id} AND project_id = ${projectA.id}
    `;
    await sql`
      UPDATE wf_nodes n
      SET primary_block_pinned_item_id = NULL, updated_at = now()
      WHERE n.primary_block_pinned_item_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM open_items o
          WHERE o.id = n.primary_block_pinned_item_id AND o.project_id = n.project_id
        )
    `;
    const pin = await sql<{ primary_block_pinned_item_id: string | null }[]>`
      SELECT primary_block_pinned_item_id FROM wf_nodes WHERE id = ${outlineA.id}
    `;
    expect(pin[0]?.primary_block_pinned_item_id).toBeNull();
    await sql`
      ALTER TABLE wf_nodes
        ADD CONSTRAINT fk_wf_nodes_primary_block_item_project
        FOREIGN KEY (project_id, primary_block_pinned_item_id) REFERENCES open_items (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
    `;
    await sql`DELETE FROM commercial_projects WHERE id IN (${projectA.id}, ${projectB.id})`;
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
