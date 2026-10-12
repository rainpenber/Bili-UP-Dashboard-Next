import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSql, runMigrations } from '@studio/db';
import { createApp } from './app';

const pgAvailable = Boolean(process.env.CI || process.env.POSTGRES_PASSWORD);
const mockRoot = join(import.meta.dir, '../../../packages/monitoring/fixtures/mock-data');

describe('HTTP imports API', () => {
  const sql = pgAvailable ? createSql() : null;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    if (!sql) return;
    process.env.MOCK_DATA_ROOT = mockRoot;
    process.env.MONITOR_ASSETS_ROOT = join(mockRoot, 'assets');
    await runMigrations(sql);
    await sql`
      TRUNCATE source_metric_rows, import_conflicts_or_rejects, source_file_provenance, source_files,
        applied_canonical_sources, applied_source_provenance, applied_source_files,
        creator_follower_samples, video_metric_samples, dynamic_metric_samples,
        static_assets, creators, videos, dynamics, import_batches RESTART IDENTITY CASCADE
    `;
    app = createApp({ skipDb: true });
    const { createImportRoutes } = await import('./import-routes');
    app.route('/api/v1/imports', createImportRoutes(sql));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  test('POST dry-run returns batch report', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/imports/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'dry-run', sourceTimezone: 'Asia/Shanghai' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batchId).toBeDefined();
    expect(body.report.stagingRows).toBeGreaterThan(0);
  });

  test('GET batch returns evidence counts', async () => {
    if (!sql) return;
    const post = await app.request('/api/v1/imports/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'dry-run' }),
    });
    const created = await post.json();
    const res = await app.request(`/api/v1/imports/${created.batchId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence.stagingRows).toBeGreaterThan(0);
  });

  test('POST apply then repeat apply is no-op', async () => {
    if (!sql) return;
    await sql`
      TRUNCATE source_metric_rows, import_conflicts_or_rejects, source_file_provenance, source_files,
        applied_canonical_sources, applied_source_provenance, applied_source_files,
        creator_follower_samples, video_metric_samples, dynamic_metric_samples,
        static_assets, creators, videos, dynamics, import_batches RESTART IDENTITY CASCADE
    `;
    const first = await app.request('/api/v1/imports/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'apply' }),
    });
    expect(first.status).toBe(200);
    const second = await app.request('/api/v1/imports/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'apply' }),
    });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.report.noOp).toBe(true);
  });

  test('returns 400 on invalid mode', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/imports/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'inventory' }),
    });
    expect(res.status).toBe(400);
  });
});
