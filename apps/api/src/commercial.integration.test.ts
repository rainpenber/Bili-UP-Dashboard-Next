import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSql, runMigrations } from '@studio/db';
import { createApp } from './app';
import { createCommercialRoutes } from './commercial-routes';

const pgAvailable = Boolean(process.env.CI || process.env.POSTGRES_PASSWORD);

describe('commercial API integration', () => {
  const sql = pgAvailable ? createSql() : null;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    if (!sql) return;
    await runMigrations(sql);
    app = createApp({ skipDb: true });
    app.route('/api/v1/commercial', createCommercialRoutes(sql));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  test('advance-to vs complete semantics on parallel graph', async () => {
    if (!sql) return;
    const createRes = await app.request('/api/v1/commercial/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test-parallel-advance' }),
    });
    expect(createRes.status).toBe(201);
    const project = await createRes.json();
    const wfRes = await app.request(`/api/v1/commercial/projects/${project.id}/workflow`);
    const wf = await wfRes.json();
    const outline = wf.nodes.find((n: { slug: string | null }) => n.slug === 'outline');
    expect(outline).toBeTruthy();
    const adv = await app.request(
      `/api/v1/commercial/projects/${project.id}/nodes/${outline.id}/advance-to`,
      { method: 'POST' },
    );
    expect(adv.status).toBe(200);
    const wf2 = await adv.json();
    const outlineAfter = wf2.nodes.find((n: { id: string }) => n.id === outline.id);
    expect(outlineAfter.status).toBe('in_progress');
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('publish idempotency conflict on payload mismatch', async () => {
    if (!sql) return;
    const createRes = await app.request('/api/v1/commercial/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test-publish-idem' }),
    });
    const project = await createRes.json();
    const payload = {
      bvid: 'BVTESTIDEM1',
      publishedAt: '2026-06-01T10:00:00.000Z',
      idempotencyKey: `pub-key-${project.id}`,
    };
    const first = await app.request(`/api/v1/commercial/projects/${project.id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    const second = await app.request(`/api/v1/commercial/projects/${project.id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, bvid: 'BVOTHER' }),
    });
    expect(second.status).toBe(409);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('cross-project edge rejected at database', async () => {
    if (!sql) return;
    const a = await (
      await app.request('/api/v1/commercial/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'test-cross-a' }),
      })
    ).json();
    const b = await (
      await app.request('/api/v1/commercial/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'test-cross-b' }),
      })
    ).json();
    const wfB = await (await app.request(`/api/v1/commercial/projects/${b.id}/workflow`)).json();
    const nodeB = wfB.nodes[0];
    const wfA = await sql<
      { id: string }[]
    >`SELECT id FROM project_workflows WHERE project_id = ${a.id}`;
    let threw = false;
    try {
      await sql`
        INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
        SELECT ${crypto.randomUUID()}, ${wfA[0]!.id}, n.id, ${nodeB.id}
        FROM wf_nodes n WHERE n.project_id = ${a.id} LIMIT 1
      `;
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    await sql`DELETE FROM commercial_projects WHERE id IN (${a.id}, ${b.id})`;
  });
});
