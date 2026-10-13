import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  FIXTURE_NOW_ISO,
  FIXTURE_PROJECT_IDS,
  createSql,
  runMigrations,
  seedProjectFixtures,
} from '@studio/db';
import { createApp } from './app';
import { createDashboardRoutes, createHermesRoutes, createProjectRoutes } from './project-routes';

const pgAvailable = Boolean(process.env.CI || process.env.POSTGRES_PASSWORD);

describe('projects API integration', () => {
  const sql = pgAvailable ? createSql() : null;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    if (!sql) return;
    await runMigrations(sql);
    await sql`
      TRUNCATE hermes_change_proposals, open_items, workflow_node_status_history,
      workflow_node_dependencies, workflow_nodes, project_workflows, projects RESTART IDENTITY CASCADE
    `;
    await seedProjectFixtures(sql);
    app = createApp({ skipDb: true });
    app.route('/api/v1/projects', createProjectRoutes(sql));
    app.route('/api/v1/dashboard', createDashboardRoutes(sql));
    app.route('/api/v1/hermes', createHermesRoutes(sql));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  test('default list hides archived fixture (3 items)', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/projects?page=1&pageSize=20');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(3);
    expect(body.items.some((p: { id: string }) => p.id === FIXTURE_PROJECT_IDS.archived)).toBe(
      false,
    );
  });

  test('includeArchived returns all 4 fixtures', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/projects?page=1&pageSize=20&includeArchived=true');
    const body = await res.json();
    expect(body.items.length).toBe(4);
    expect(body.items.some((p: { id: string }) => p.id === FIXTURE_PROJECT_IDS.archived)).toBe(
      true,
    );
  });

  test('creates project with standard workflow', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '集成测试项目' }),
    });
    expect(res.status).toBe(201);
    const project = await res.json();
    const wfRes = await app.request(`/api/v1/projects/${project.id}/workflow`);
    expect(wfRes.status).toBe(200);
    const wf = await wfRes.json();
    expect(wf.nodes.length).toBe(8);
  });

  test('patch node invalid transition returns 409', async () => {
    if (!sql) return;
    const wfRes = await app.request(`/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/workflow`);
    const wf = await wfRes.json();
    const locked = wf.nodes.find((n: { status: string }) => n.status === 'locked');
    const res = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/workflow/nodes/${locked.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      },
    );
    expect(res.status).toBe(409);
  });

  test('patch project allows explicit null brand', async () => {
    if (!sql) return;
    const res = await app.request(`/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand: null }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brand).toBeNull();
  });

  test('dashboard uses referenceNow for deterministic overdue', async () => {
    if (!sql) return;
    const res = await app.request(
      `/api/v1/dashboard/today?referenceNow=${encodeURIComponent(FIXTURE_NOW_ISO)}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overdue.length).toBeGreaterThan(0);
    expect(body.overdue.every((e: { id: string }) => !e.id.includes('completed'))).toBe(true);
  });

  test('hermes idempotency key returns same proposal on concurrent create', async () => {
    if (!sql) return;
    const payload = {
      projectId: FIXTURE_PROJECT_IDS.progressing,
      idempotencyKey: 'test-key-001',
      suggestedAction: 'patch_project',
      payload: { action: 'patch_project', name: 'Hermes 重命名' },
      confidence: 0.2,
    };
    const [first, second] = await Promise.all([
      app.request('/api/v1/hermes/change-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      app.request('/api/v1/hermes/change-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    ]);
    const a = await first.json();
    const b = await second.json();
    expect(a.id).toBe(b.id);
  });

  test('hermes rejects malformed payload at create', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/hermes/change-proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: FIXTURE_PROJECT_IDS.progressing,
        idempotencyKey: 'bad-payload',
        suggestedAction: 'patch_node',
        payload: { action: 'patch_project' },
        confidence: 0.1,
      }),
    });
    expect(res.status).toBe(400);
  });

  test('hermes accept applies once and duplicate accept is idempotent', async () => {
    if (!sql) return;
    const create = await app.request('/api/v1/hermes/change-proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: FIXTURE_PROJECT_IDS.progressing,
        idempotencyKey: 'accept-once',
        suggestedAction: 'create_open_item',
        payload: {
          action: 'create_open_item',
          itemType: 'our_action',
          title: 'Hermes 事项',
          responsibleParty: 'us',
        },
        confidence: 0.9,
      }),
    });
    const proposal = await create.json();
    const before = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/open-items`,
    );
    const beforeBody = await before.json();

    const [accept1, accept2] = await Promise.all([
      app.request(`/api/v1/hermes/change-proposals/${proposal.id}/accept`, { method: 'POST' }),
      app.request(`/api/v1/hermes/change-proposals/${proposal.id}/accept`, { method: 'POST' }),
    ]);
    expect(accept1.status).toBe(200);
    expect(accept2.status).toBe(200);

    const after = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/open-items`,
    );
    const afterBody = await after.json();
    expect(afterBody.items.length).toBe(beforeBody.items.length + 1);
    expect((await accept2.json()).status).toBe('accepted');
  });

  test('hermes accept invalid stored payload returns 400 without accepting', async () => {
    if (!sql) return;
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO hermes_change_proposals (id, project_id, idempotency_key, suggested_action, payload, confidence)
      VALUES (
        ${id}, ${FIXTURE_PROJECT_IDS.progressing}, ${'invalid-store-' + id},
        'patch_node', ${JSON.stringify({ action: 'unknown' })}::jsonb, 0.5
      )
    `;
    const res = await app.request(`/api/v1/hermes/change-proposals/${id}/accept`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    const row = await sql<{ status: string }[]>`
      SELECT status FROM hermes_change_proposals WHERE id = ${id}
    `;
    expect(row[0]?.status).toBe('pending');
  });

  test('hermes accept patch_node keeps dueAt set before accept (no stale snapshot)', async () => {
    if (!sql) return;
    const wfRes = await app.request(`/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/workflow`);
    const wf = await wfRes.json();
    const node = wf.nodes.find((n: { status: string }) => n.status !== 'locked') ?? wf.nodes[0];
    const preservedDue = '2027-01-01T00:00:00.000Z';
    const patchDue = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/workflow/nodes/${node.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dueAt: preservedDue }),
      },
    );
    expect(patchDue.status).toBe(200);

    const create = await app.request('/api/v1/hermes/change-proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: FIXTURE_PROJECT_IDS.progressing,
        idempotencyKey: 'accept-node-due-preserve',
        suggestedAction: 'patch_node',
        payload: {
          action: 'patch_node',
          nodeId: node.id,
          blockedReason: 'Hermes 备注',
        },
        confidence: 0.5,
      }),
    });
    const proposal = await create.json();
    const accept = await app.request(`/api/v1/hermes/change-proposals/${proposal.id}/accept`, {
      method: 'POST',
    });
    expect(accept.status).toBe(200);

    const wfAfter = await (
      await app.request(`/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/workflow`)
    ).json();
    const nodeAfter = wfAfter.nodes.find((n: { id: string }) => n.id === node.id);
    expect(nodeAfter.blockedReason).toBe('Hermes 备注');
    expect(nodeAfter.dueAt).toBe(preservedDue);
  });

  test('hermes concurrent accept creates a single open item', async () => {
    if (!sql) return;
    const create = await app.request('/api/v1/hermes/change-proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: FIXTURE_PROJECT_IDS.progressing,
        idempotencyKey: 'concurrent-accept-items',
        suggestedAction: 'create_open_item',
        payload: {
          action: 'create_open_item',
          itemType: 'our_action',
          title: '并发 accept 事项',
          responsibleParty: 'us',
        },
        confidence: 0.9,
      }),
    });
    const proposal = await create.json();
    const before = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/open-items`,
    );
    const beforeCount = (await before.json()).items.length;

    const [acceptA, acceptB] = await Promise.all([
      app.request(`/api/v1/hermes/change-proposals/${proposal.id}/accept`, { method: 'POST' }),
      app.request(`/api/v1/hermes/change-proposals/${proposal.id}/accept`, { method: 'POST' }),
    ]);
    expect(acceptA.status).toBe(200);
    expect(acceptB.status).toBe(200);
    const bodyA = await acceptA.json();
    const bodyB = await acceptB.json();
    expect(bodyA.status).toBe('accepted');
    expect(bodyB.status).toBe('accepted');
    expect(bodyA.id).toBe(bodyB.id);

    const after = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/open-items`,
    );
    expect((await after.json()).items.length).toBe(beforeCount + 1);
  });

  test('patch open item updates type workflowNode and confirmation fields', async () => {
    if (!sql) return;
    const staffId = '33333333-3333-4333-8333-333333333333';
    const create = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/open-items`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemType: 'our_action',
          title: '可编辑事项',
          responsibleParty: 'us',
        }),
      },
    );
    const item = await create.json();
    const wf = await (
      await app.request(`/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/workflow`)
    ).json();
    const nodeId = wf.nodes[0].id;
    const patch = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/open-items/${item.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemType: 'confirmation',
          workflowNodeId: nodeId,
          humanConfirmed: true,
          confirmedById: staffId,
        }),
      },
    );
    expect(patch.status).toBe(200);
    const body = await patch.json();
    expect(body.itemType).toBe('confirmation');
    expect(body.workflowNodeId).toBe(nodeId);
    expect(body.humanConfirmed).toBe(true);
    expect(body.confirmedBy?.id).toBe(staffId);

    const bad = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/open-items/${item.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmedById: staffId }),
      },
    );
    expect(bad.status).toBe(400);
  });

  test('patch open item title only preserves confirmation timestamp', async () => {
    if (!sql) return;
    const staffId = '33333333-3333-4333-8333-333333333333';
    const create = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/open-items`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemType: 'confirmation',
          title: '确认时间锚点',
          responsibleParty: 'us',
          humanConfirmed: true,
          confirmedById: staffId,
        }),
      },
    );
    const item = await create.json();
    const confirmedAtBefore = item.confirmedAt;

    const patch = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/open-items/${item.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '仅改标题' }),
      },
    );
    expect(patch.status).toBe(200);
    const updated = await patch.json();
    expect(updated.title).toBe('仅改标题');
    expect(updated.confirmedAt).toBe(confirmedAtBefore);
    expect(updated.confirmedBy?.id).toBe(staffId);
  });

  test('hermes create_open_item rejects humanConfirmed without confirmedById', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/hermes/change-proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: FIXTURE_PROJECT_IDS.progressing,
        idempotencyKey: 'bad-confirm-payload',
        suggestedAction: 'create_open_item',
        payload: {
          action: 'create_open_item',
          itemType: 'confirmation',
          title: '无确认人',
          responsibleParty: 'us',
          humanConfirmed: true,
        },
        confidence: 0.1,
      }),
    });
    expect(res.status).toBe(400);
  });
});
