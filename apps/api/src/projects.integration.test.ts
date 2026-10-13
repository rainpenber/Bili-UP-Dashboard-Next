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

  test('lists fixture projects', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/projects?page=1&pageSize=20');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(4);
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
    expect(wf.nodes.some((n: { status: string }) => n.status === 'ready')).toBe(true);
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

  test('advancing node opens downstream', async () => {
    if (!sql) return;
    const wfRes = await app.request(`/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/workflow`);
    const wf = await wfRes.json();
    const production = wf.nodes.find((n: { slug: string }) => n.slug === 'production');
    const res = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/workflow/nodes/${production.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      },
    );
    expect(res.status).toBe(200);
    const next = await res.json();
    const review = next.nodes.find((n: { slug: string }) => n.slug === 'review');
    expect(review.status).toBe('ready');
  });

  test('archive and restore', async () => {
    if (!sql) return;
    const archive = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/archive`,
      { method: 'POST' },
    );
    expect(archive.status).toBe(200);
    const archived = await archive.json();
    expect(archived.archivedAt).not.toBeNull();
    const restore = await app.request(
      `/api/v1/projects/${FIXTURE_PROJECT_IDS.progressing}/restore`,
      { method: 'POST' },
    );
    expect(restore.status).toBe(200);
  });

  test('dashboard uses referenceNow for deterministic overdue', async () => {
    if (!sql) return;
    const res = await app.request(
      `/api/v1/dashboard/today?referenceNow=${encodeURIComponent(FIXTURE_NOW_ISO)}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overdue.length).toBeGreaterThan(0);
    expect(body.overdue[0].explanation).toBeTruthy();
  });

  test('hermes idempotency key is no-op duplicate', async () => {
    if (!sql) return;
    const payload = {
      projectId: FIXTURE_PROJECT_IDS.progressing,
      idempotencyKey: 'test-key-001',
      suggestedAction: 'noop',
      payload: { action: 'patch_project', name: 'ignored until accept' },
      confidence: 0.2,
    };
    const first = await app.request('/api/v1/hermes/change-proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const second = await app.request('/api/v1/hermes/change-proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const a = await first.json();
    const b = await second.json();
    expect(a.id).toBe(b.id);
  });
});
