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

describe('commercial API integration', () => {
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
    if (extra.status !== 201) {
      throw new Error(`create node failed: ${extra.status} ${await extra.text()}`);
    }
    const wf2 = await extra.json();
    const temp = wf2.nodes.find((n: { name: string }) => n.name === '临时节点');
    const inquiry = wf2.nodes.find((n: { slug: string | null }) => n.slug === 'inquiry');
    expect(temp && inquiry).toBeTruthy();
    const connect = await app.request(`/api/v1/commercial/projects/${project.id}/edges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromNodeId: inquiry!.id, toNodeId: temp!.id }),
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
      autoApply: false,
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
    if (del.status !== 200) {
      throw new Error(`delete node failed: ${del.status} ${await del.text()}`);
    }
    const items = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/open-items`)
    ).json();
    expect(items.items[0].workflowNodeId).toBeNull();
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('hermes delete_graph_node clears open item refs before delete', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-hermes-delete-node');
    const createNode = await app.request(`/api/v1/commercial/projects/${project.id}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hermes 可删', posX: 80, posY: 80 }),
    });
    const wf = await createNode.json();
    const node = wf.nodes.find((n: { name: string }) => n.name === 'Hermes 可删');
    const itemRes = await app.request(`/api/v1/commercial/projects/${project.id}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Hermes 关联',
        nextActor: 'us',
        workflowNodeId: node.id,
        impact: 'blocking',
        blocksNodeId: node.id,
      }),
    });
    expect(itemRes.status).toBe(201);
    const del = await app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `hermes-del-${project.id}-${node.id}`,
        operation: 'delete_graph_node',
        confidence: 1,
        autoApply: true,
        payload: { projectId: project.id, nodeId: node.id },
      }),
    });
    expect(del.status).toBe(200);
    const items = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/open-items`)
    ).json();
    expect(items.items[0].workflowNodeId).toBeNull();
    expect(items.items[0].blocksNodeId).toBeNull();
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('undo restores open item node refs after graph snapshot', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-undo-item-refs');
    const wf0 = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const anchor = wf0.nodes.find((n: { slug: string | null }) => n.slug === 'outline');
    const itemRes = await app.request(`/api/v1/commercial/projects/${project.id}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '绑定大纲',
        nextActor: 'us',
        workflowNodeId: anchor.id,
      }),
    });
    const item = await itemRes.json();
    const add = await app.request(`/api/v1/commercial/projects/${project.id}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '临时节点',
        posX: 300,
        posY: 300,
        anchorNodeId: anchor.id,
        connectMode: 'serial',
      }),
    });
    expect(add.status).toBe(201);
    const undo = await app.request(`/api/v1/commercial/projects/${project.id}/workflow/undo`, {
      method: 'POST',
    });
    expect(undo.status).toBe(200);
    const items = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/open-items`)
    ).json();
    expect(items.items.find((i: { id: string }) => i.id === item.id)?.workflowNodeId).toBe(
      anchor.id,
    );
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

  test('hermes proposal idempotency rejects payload drift with 409', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-hermes-drift');
    const key = `hermes-drift-${project.id}`;
    const base = {
      idempotencyKey: key,
      operation: 'create_open_item',
      confidence: 0.5,
      autoApply: false,
      payload: { projectId: project.id, title: 'A', nextActor: 'us' },
    };
    const r1 = await app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(base),
    });
    expect(r1.status).toBe(200);
    const r2 = await app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...base,
        payload: { projectId: project.id, title: 'B', nextActor: 'us' },
      }),
    });
    expect(r2.status).toBe(409);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('hermes proposal canonical payload matches reordered keys', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-hermes-canonical');
    const key = `hermes-can-${project.id}`;
    const bodyA = {
      idempotencyKey: key,
      operation: 'create_open_item',
      confidence: 0.5,
      autoApply: false,
      payload: { nextActor: 'us', projectId: project.id, title: 'Same' },
    };
    const bodyB = {
      idempotencyKey: key,
      operation: 'create_open_item',
      confidence: 0.5,
      autoApply: false,
      payload: { projectId: project.id, title: 'Same', nextActor: 'us' },
    };
    const r1 = await app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bodyA),
    });
    const r2 = await app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bodyB),
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.proposalId).toBe(j2.proposalId);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('open item cannot reference node from another project', async () => {
    if (!sql) return;
    const a = await createProject(app, 'test-item-cross-a');
    const b = await createProject(app, 'test-item-cross-b');
    const wfB = await (await app.request(`/api/v1/commercial/projects/${b.id}/workflow`)).json();
    const nodeB = wfB.nodes[0];
    const bad = await app.request(`/api/v1/commercial/projects/${a.id}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '跨项目引用',
        nextActor: 'us',
        workflowNodeId: nodeB.id,
      }),
    });
    expect(bad.status).toBe(409);
    await sql`DELETE FROM commercial_projects WHERE id IN (${a.id}, ${b.id})`;
  });

  test('undo restores template_node_id and source on template nodes', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-undo-template-id');
    const wf0 = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const tplNode = wf0.nodes.find((n: { templateNodeId?: string | null }) => n.templateNodeId);
    expect(tplNode).toBeTruthy();
    await app.request(`/api/v1/commercial/projects/${project.id}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '临时', posX: 50, posY: 50 }),
    });
    const undo = await app.request(`/api/v1/commercial/projects/${project.id}/workflow/undo`, {
      method: 'POST',
    });
    expect(undo.status).toBe(200);
    const wf1 = await undo.json();
    const restored = wf1.nodes.find((n: { id: string }) => n.id === tplNode.id);
    expect(restored?.templateNodeId).toBe(tplNode.templateNodeId);
    expect(restored?.source).toBe('template');
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('batch graph layout rolls back atomically on invalid node', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-layout-rollback');
    const wf = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const n = wf.nodes[0];
    const beforeX = n.posX;
    const bad = await app.request(`/api/v1/commercial/projects/${project.id}/workflow/layout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodes: [
          { nodeId: n.id, posX: 9999, posY: 8888 },
          { nodeId: crypto.randomUUID(), posX: 1, posY: 1 },
        ],
      }),
    });
    expect(bad.status).toBe(404);
    const wf2 = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    expect(wf2.nodes.find((x: { id: string }) => x.id === n.id)!.posX).toBe(beforeX);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('concurrent hermes direct writes return identical canonical workflow', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-hermes-canonical-wf');
    const outlineId = (
      await (await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)).json()
    ).nodes.find((n: { slug: string | null }) => n.slug === 'outline').id;
    const body = {
      idempotencyKey: `hermes-wf-can-${project.id}`,
      operation: 'advance_node',
      confidence: 1,
      autoApply: true,
      payload: { projectId: project.id, nodeId: outlineId },
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
    const wf = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    expect(wf.nodes.find((n: { slug: string | null }) => n.slug === 'outline')!.status).toBe(
      'in_progress',
    );
    const audit = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM workflow_audit_log
      WHERE project_id = ${project.id} AND entity_type = 'hermes'
    `;
    expect(Number(audit[0]?.c)).toBe(1);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });

  test('hermes upsert_project without projectId retries same result', async () => {
    if (!sql) return;
    const key = `hermes-upsert-${crypto.randomUUID()}`;
    const body = {
      idempotencyKey: key,
      operation: 'upsert_project',
      confidence: 1,
      autoApply: true,
      payload: { name: 'Hermes 新建项目' },
    };
    const r1 = await app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    const projectId = j1.projectId as string;
    expect(projectId).toMatch(/^[0-9a-f-]{36}$/i);
    const r2 = await app.request('/api/v1/commercial/hermes/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(r2.status).toBe(200);
    const j2 = await r2.json();
    expect(j2.projectId).toBe(projectId);
    const projCount = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM commercial_projects WHERE name = 'Hermes 新建项目'
    `;
    expect(projCount[0]?.c).toBe('1');
    const idem = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM hermes_idempotency WHERE idempotency_key = ${key}
    `;
    expect(idem[0]?.c).toBe('1');
    await sql`DELETE FROM commercial_projects WHERE id = ${projectId}`;
  });

  test('complete node rejects when required predecessors unfinished', async () => {
    if (!sql) return;
    const project = await createProject(app, 'test-complete-guard');
    const wf = await (
      await app.request(`/api/v1/commercial/projects/${project.id}/workflow`)
    ).json();
    const review = wf.nodes.find((n: { slug: string | null }) => n.slug === 'review');
    expect(review).toBeTruthy();
    const res = await app.request(
      `/api/v1/commercial/projects/${project.id}/nodes/${review!.id}/complete`,
      { method: 'POST' },
    );
    expect(res.status).toBe(409);
    await sql`DELETE FROM commercial_projects WHERE id = ${project.id}`;
  });
});
