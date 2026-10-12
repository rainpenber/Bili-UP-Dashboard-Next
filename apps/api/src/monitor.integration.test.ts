import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSql, runMigrations } from '@studio/db';
import { runImport } from '@studio/monitoring';
import { createApp } from './app';

const pgAvailable = Boolean(process.env.CI || process.env.POSTGRES_PASSWORD);

describe('monitor API integration', () => {
  const sql = pgAvailable ? createSql() : null;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    if (!sql) return;
    await runMigrations(sql);
    await sql`TRUNCATE import_conflicts_or_rejects, source_file_provenance, source_files, applied_source_files, creator_follower_samples, video_metric_samples, dynamic_metric_samples, creators, videos, dynamics, import_batches RESTART IDENTITY CASCADE`;
    const fixtureBackend = join(import.meta.dir, '../../../packages/monitoring/fixtures/backend');
    const fixtureFrontend = join(import.meta.dir, '../../../packages/monitoring/fixtures/frontend');
    await runImport({
      mode: 'apply',
      backendRoot: fixtureBackend,
      frontendRoot: fixtureFrontend,
      assetsRoot: join(fixtureFrontend, 'meta'),
      sourceTimezone: 'Asia/Shanghai',
      sql,
    });
    app = createApp({ skipDb: true });
    // mount routes manually with shared sql
    const { createMonitorRoutes } = await import('./monitor-routes');
    app.route('/api/v1/monitor', createMonitorRoutes(sql));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  test('lists videos with pagination', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/monitor/videos?page=1&pageSize=8');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageSize).toBe(8);
    expect(body.items.length).toBeGreaterThan(0);
    expect(typeof body.items[0].latestMetrics.viewCount).toBe('string');
  });

  test('metrics limit cap returns 400 when invalid', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/monitor/videos/BVTEST001/metrics?limit=999999');
    expect(res.status).toBe(400);
  });
});
