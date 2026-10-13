import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSql, postgresAvailable, runMigrations, seedCommercialFixtures } from '@studio/db';
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

describe('commercial API integration', () => {
  let sql: ReturnType<typeof createSql> | null = null;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    if (!(await postgresAvailable())) return;
    sql = createSql();
    await runMigrations(sql);
    await seedCommercialFixtures(sql);
    app = createApp({ skipDb: true });
    app.route('/api/v1/commercial', createCommercialRoutes(sql));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  test('advance-to vs complete semantics on parallel graph', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-parallel-advance');
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

  test('parallel in_progress branches survive advance-to on sibling', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-parallel-keep');
    const wf = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const aRoll = wf.nodes.find((n: { slug: string | null }) => n.slug === 'a_roll');
    const bRoll = wf.nodes.find((n: { slug: string | null }) => n.slug === 'b_roll');
    expect(aRoll && bRoll).toBeTruthy();
    await app.request(`/api/v1/commercial/projects/${project.id}/nodes/${aRoll.id}/advance-to`, {
      method: 'POST',
    });
    await app.request(`/api/v1/commercial/projects/${project.id}/nodes/${bRoll.id}/advance-to`, {
      method: 'POST',
    });
    const wfMid = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const aSt = wfMid.nodes.find((n: { id: string }) => n.id === aRoll.id)!.status;
    const bSt = wfMid.nodes.find((n: { id: string }) => n.id === bRoll.id)!.status;
    expect(aSt).toBe('in_progress');
    expect(bSt).toBe('in_progress');
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('add edge on non-empty workflow graph', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-add-edge');
    const wf = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    expect(wf.edges.length).toBeGreaterThan(0);
    const extra = await app.request(`/api/v1/commercial/projects/${project.id}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '临时节点', posX: 900, posY: 400 }),
    });
    expect(extra.status).toBe(201);
    const wf2 = await extra.json();
    const temp = wf2.nodes.find((n: { name: string }) => n.name === '临时节点');
    const other = wf2.nodes.find((n: { slug: string | null }) => n.slug === 'other');
    expect(temp && other).toBeTruthy();
    const connect = await app.request(`/api/v1/commercial/projects/${project.id}/edges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromNodeId: temp!.id, toNodeId: other!.id }),
    });
    expect(connect.status).toBe(201);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('publish idempotency conflict on payload mismatch', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-publish-idem');
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

  test('publish creates monitor jobs and video row', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-publish-monitor');
    const bvid = 'BVTESTMON01';
    const res = await app.request(`/api/v1/commercial/projects/${project.id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bvid,
        publishedAt: '2026-06-02T10:00:00.000Z',
        idempotencyKey: `mon-${project.id}`,
      }),
    });
    expect(res.status).toBe(200);
    const jobs = await sql<{ job_type: string }[]>`
      SELECT job_type FROM monitor_jobs WHERE project_id = ${project.id} ORDER BY job_type
    `;
    expect(jobs.map((j) => j.job_type)).toEqual(['metadata', 'metrics']);
    const videos = await sql<{ bvid: string }[]>`SELECT bvid FROM videos WHERE bvid = ${bvid}`;
    expect(videos.length).toBe(1);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('cross-project edge rejected at database', async () => {
    if (!sql) return;
    const a = await createProject(app, 'test-cross-a');
    const b = await createProject(app, 'test-cross-b');
    const wfB = await (await app.request(`/api/v1/commercial/projects/${b.id}/workflow`)).json();
    const nodeB = wfB.nodes[0];
    const wfA = await sql<{ id: string }[]>`
      SELECT id FROM project_workflows WHERE project_id = ${a.id}
    `;
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

  test('template draft copies default graph', async () => {
    if (!sql) return;
    const draftRes = await app.request('/api/v1/commercial/templates/draft-from-default', {
      method: 'POST',
    });
    expect(draftRes.status).toBe(200);
    const { draftId } = await draftRes.json();
    const graph = await (
      await app.request(`/api/v1/commercial/templates/versions/${draftId}/graph`)
    ).json();
    expect(graph.nodes.length).toBeGreaterThan(5);
    expect(graph.edges.length).toBeGreaterThan(3);
    await sql`DELETE FROM wf_template_versions WHERE id = ${draftId}`;
  });

  test('hermes low confidence proposal returns stable id on duplicate key', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-hermes-prop');
    const body = {
      idempotencyKey: `hermes-prop-${project.id}`,
      operation: 'create_open_item',
      confidence: 0.5,
      payload: {
        projectId: project.id,
        title: '候选事项',
        nextActor: 'us',
      },
    };
    const r1 = await app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const r2 = await app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.proposalId).toBe(j2.proposalId);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('open item blocking requires node; unblock restores not_reached', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-block-restore');
    const wf = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const outline = wf.nodes.find((n: { slug: string | null }) => n.slug === 'outline')!;
    await app.request(`/api/v1/commercial/projects/${project.id}/nodes/${outline.id}/advance-to`, {
      method: 'POST',
    });
    const bad = await app.request(`/api/v1/commercial/projects/${project.id}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '阻塞无节点', nextActor: 'us', impact: 'blocking' }),
    });
    expect(bad.status).toBe(400);
    const good = await app.request(`/api/v1/commercial/projects/${project.id}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '阻塞大纲',
        nextActor: 'us',
        impact: 'blocking',
        blocksNodeId: outline.id,
      }),
    });
    expect(good.status).toBe(201);
    const wfBlocked = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    expect(wfBlocked.nodes.find((n: { id: string }) => n.id === outline.id)!.status).toBe(
      'blocked',
    );
    const item = await good.json();
    await app.request(`/api/v1/commercial/projects/${project.id}/open-items/${item.id}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conclusion: '已确认' }),
    });
    const wfOpen = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    expect(wfOpen.nodes.find((n: { id: string }) => n.id === outline.id)!.status).toBe(
      'in_progress',
    );
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('delete referenced node clears open item workflow_node_id', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-node-delete-fk');
    const createNode = await app.request(`/api/v1/commercial/projects/${project.id}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '可删节点', posX: 100, posY: 100 }),
    });
    const wf = await createNode.json();
    const node = wf.nodes.find((n: { name: string }) => n.name === '可删节点');
    const itemRes = await app.request(`/api/v1/commercial/projects/${project.id}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '关联可删节点',
        nextActor: 'us',
        workflowNodeId: node.id,
      }),
    });
    expect(itemRes.status).toBe(201);
    const del = await app.request(`/api/v1/commercial/projects/${project.id}/nodes/${node.id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    const items = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/open-items`)
    ).json();
    expect(items.items[0].workflowNodeId).toBeNull();
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('concurrent hermes direct writes apply once', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-hermes-concurrent');
    const body = {
      idempotencyKey: `hermes-conc-${project.id}`,
      operation: 'advance_node',
      confidence: 1,
      autoApply: true,
      payload: {
        projectId: project.id,
        nodeId: (
          await (await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)).json()
        ).nodes.find((n: { slug: string | null }) => n.slug === 'outline').id,
      },
    };
    const [r1, r2] = await Promise.all([
      app.request('/api/v1/commercial/hermes/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      app.request('/api/v1/commercial/hermes/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const idem = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM hermes_idempotency WHERE idempotency_key = ${body.idempotencyKey}
    `;
    expect(idem[0]?.c).toBe('1');
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('fixture seeder is idempotent for node counts', async () => {
    if (!sql) return;
    const before = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_nodes
    `;
    await seedCommercialFixtures(sql);
    const after = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_nodes
    `;
    expect(after[0]!.c).toBe(before[0]!.c);
  });
});
