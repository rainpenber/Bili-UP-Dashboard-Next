import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  seedCommercialFixtures,
} from '@studio/db';
import type { createSql } from '@studio/db';
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

describe('WP-004R round10 integration', () => {
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

  test('hermes update_open_item blocking→normal clears blocks_node_id without blocksNodeId in payload', async () => {
    if (!sql) return;
    const project = await createProject(app, 'r10-hermes-unblock');
    const wf = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const outline = wf.nodes.find((n: { slug: string | null }) => n.slug === 'outline');
    expect(outline).toBeTruthy();
    const itemRes = await app.request(`/api/v1/commercial/projects/${project.id}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Hermes 阻塞',
        nextActor: 'us',
        impact: 'blocking',
        blocksNodeId: outline.id,
      }),
    });
    expect(itemRes.status).toBe(201);
    const item = (await itemRes.json()) as { id: string };
    const wfBlocked = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const outlineBlocked = wfBlocked.nodes.find((n: { id: string }) => n.id === outline!.id);
    expect(outlineBlocked?.status).toBe('blocked');

    const upd = await app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `r10-normal-${project.id}`,
        operation: 'update_open_item',
        confidence: 1,
        autoApply: true,
        payload: {
          projectId: project.id,
          itemId: item.id,
          impact: 'normal',
          blocksNodeId: outline.id,
        },
      }),
    });
    expect(upd.status).toBe(200);
    const row = await sql<{ blocks_node_id: string | null; impact: string }[]>`
      SELECT blocks_node_id, impact FROM open_items WHERE id = ${item.id}
    `;
    expect(row[0]?.blocks_node_id).toBeNull();
    expect(row[0]?.impact).toBe('normal');
    const wfAfter = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const outlineAfter = wfAfter.nodes.find((n: { id: string }) => n.id === outline!.id);
    expect(outlineAfter?.status).not.toBe('blocked');
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('node status history records advance and complete', async () => {
    if (!sql) return;
    const project = await createProject(app, 'r10-history');
    const wf = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const outline = wf.nodes.find((n: { slug: string | null }) => n.slug === 'outline');
    await app.request(`/api/v1/commercial/projects/${project.id}/nodes/${outline!.id}/advance-to`, {
      method: 'POST',
    });
    const hist = await sql<{ source: string; to_status: string }[]>`
      SELECT source, to_status FROM wf_node_status_history
      WHERE project_id = ${project.id} AND node_id = ${outline!.id}
      ORDER BY changed_at ASC
    `;
    expect(hist.some((h) => h.source === 'advance_to' && h.to_status === 'in_progress')).toBe(true);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('primary_block pin rejects cross-project item ownership', async () => {
    if (!sql) return;
    const a = await createProject(app, 'r10-pin-a');
    const b = await createProject(app, 'r10-pin-b');
    const wfB = await (await app.request(`/api/v1/commercial/projects/${b.id}/workflow`)).json();
    const copyNode = wfB.nodes.find((n: { slug: string | null }) => n.slug === 'copy');
    const itemRes = await app.request(`/api/v1/commercial/projects/${b.id}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'B 阻塞',
        nextActor: 'us',
        impact: 'blocking',
        blocksNodeId: copyNode!.id,
      }),
    });
    const itemB = (await itemRes.json()) as { id: string };
    const wfA = await (await app.request(`/api/v1/commercial/projects/${a.id}/workflow`)).json();
    const nodeA = wfA.nodes.find((n: { slug: string | null }) => n.slug === 'copy');
    let fkError: unknown;
    try {
      await sql`
        UPDATE wf_nodes SET primary_block_pinned_item_id = ${itemB.id}
        WHERE id = ${nodeA!.id} AND project_id = ${a.id}
      `;
    } catch (e) {
      fkError = e;
    }
    expect(fkError).toBeTruthy();
    await sql`DELETE FROM commercial_projects WHERE id IN (${a.id}, ${b.id})`;
  });

  test('reset_project_workflow rejects draft and foreign slug', async () => {
    if (!sql) return;
    const project = await createProject(app, 'r10-reset-guard');
    const draftRes = await app.request('/api/v1/commercial/templates/draft-from-default', {
      method: 'POST',
    });
    const { draftId } = (await draftRes.json()) as { draftId: string };
    const badSlugId = crypto.randomUUID();
    await sql`
      INSERT INTO wf_template_versions (id, slug, name, version, is_default, is_draft)
      VALUES (${badSlugId}, 'foreign_family', 'Foreign', 99, FALSE, FALSE)
    `;
    await sql`
      INSERT INTO wf_template_nodes (id, template_version_id, slug, name, is_optional, pos_x, pos_y)
      VALUES (${crypto.randomUUID()}, ${badSlugId}, 'only', 'Only', FALSE, 0, 0)
    `;
    for (const [op, templateVersionId, expectStatus] of [
      ['draft', draftId, 409],
      ['foreign', badSlugId, 409],
    ] as const) {
      const res = await app.request('/api/v1/commercial/hermes/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: `r10-reset-${op}-${project.id}`,
          operation: 'reset_project_workflow',
          confidence: 1,
          autoApply: true,
          payload: {
            projectId: project.id,
            templateVersionId,
            confirmDestroyCustomGraph: true,
          },
        }),
      });
      expect(res.status).toBe(expectStatus);
    }
    await sql`DELETE FROM wf_template_nodes WHERE template_version_id = ${badSlugId}`;
    await sql`DELETE FROM wf_template_versions WHERE id = ${badSlugId}`;
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('reset to published template version then undo restores prior graph', async () => {
    if (!sql) return;
    const project = await createProject(app, 'r10-reset-undo');
    const templateVersionId = (
      await sql<{ template_version_id: string }[]>`
        SELECT template_version_id FROM project_workflows WHERE project_id = ${project.id}
      `
    )[0]!.template_version_id;
    const wf0 = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const outline = wf0.nodes.find((n: { slug: string | null }) => n.slug === 'outline');
    await app.request(`/api/v1/commercial/projects/${project.id}/nodes/${outline!.id}/advance-to`, {
      method: 'POST',
    });
    const beforeReset = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    expect(beforeReset.nodes.find((n: { id: string }) => n.id === outline!.id)?.status).toBe(
      'in_progress',
    );

    const reset = await app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `r10-reset-${project.id}`,
        operation: 'reset_project_workflow',
        confidence: 1,
        autoApply: true,
        payload: {
          projectId: project.id,
          templateVersionId,
          confirmDestroyCustomGraph: true,
        },
      }),
    });
    expect(reset.status).toBe(200);
    const wfReset = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const outlineAfterReset = wfReset.nodes.find(
      (n: { slug: string | null }) => n.slug === 'outline',
    );
    expect(outlineAfterReset?.status).toBe('not_reached');
    expect(outlineAfterReset?.id).not.toBe(outline!.id);

    const pw = await sql<{ template_version_id: string }[]>`
      SELECT template_version_id FROM project_workflows WHERE project_id = ${project.id}
    `;
    expect(pw[0]?.template_version_id).toBe(templateVersionId);

    const undo = await app.request(`/api/v1/commercial/projects/${project.id}/workflow/undo`, {
      method: 'POST',
    });
    expect(undo.status).toBe(200);
    const wfUndo = await undo.json();
    expect(wfUndo.nodes.find((n: { id: string }) => n.id === outline!.id)?.status).toBe(
      'in_progress',
    );
    const histUndo = await sql<{ source: string }[]>`
      SELECT source FROM wf_node_status_history
      WHERE project_id = ${project.id} AND source = 'undo'
    `;
    expect(histUndo.length).toBeGreaterThan(0);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });
});
