import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSql, runMigrations, seedCommercialFixtures, FIXTURE_PROJECT_IDS } from '@studio/db';
import { createApp } from './app';
import { createCommercialRoutes } from './commercial-routes';

const pgAvailable = Boolean(process.env.CI || process.env.POSTGRES_PASSWORD);

describe('commercial API integration', () => {
  const sql = pgAvailable ? createSql() : null;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    if (!sql) return;
    await runMigrations(sql);
    await sql`
      TRUNCATE workflow_audit_log, hermes_write_proposals, project_monitor_contracts,
      project_publish_records, open_items, wf_edges, wf_nodes, project_workflows,
      commercial_projects RESTART IDENTITY CASCADE
    `;
    await seedCommercialFixtures(sql);
    app = createApp({ skipDb: true });
    app.route('/api/v1/commercial', createCommercialRoutes(sql));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  test('home dashboard three sections', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/commercial/home');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clientOpenItems.length).toBeGreaterThan(0);
    expect(body.ourOpenItems.length).toBeGreaterThanOrEqual(0);
  });

  test('publish idempotent', async () => {
    if (!sql) return;
    const payload = {
      bvid: 'BVTESTPUB1',
      publishedAt: '2026-06-01T10:00:00.000Z',
      idempotencyKey: 'pub-key-1',
    };
    const createRes = await app.request('/api/v1/commercial/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '发布幂等测试' }),
    });
    const project = await createRes.json();
    const first = await app.request(`/api/v1/commercial/projects/${project.id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    const second = await app.request(`/api/v1/commercial/projects/${project.id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);
    const monitors = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM project_monitor_contracts WHERE project_id = ${project.id}
    `;
    expect(monitors[0]?.c).toBe('1');
  });

  test('fixtures include published winding down project', async () => {
    if (!sql) return;
    const res = await app.request(
      `/api/v1/commercial/projects/${FIXTURE_PROJECT_IDS.publishedOpen}`,
    );
    const body = await res.json();
    expect(body.overallStage).toBe('published_winding_down');
  });
});
