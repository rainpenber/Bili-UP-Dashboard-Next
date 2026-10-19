import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runMigrations } from './migrate';
import { isPostgresRequiredEnv } from './require-postgres';
import { createEmptyIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';
import type { Sql } from './client';

describe('monitor target migration', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createEmptyIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (!sql && isPostgresRequiredEnv()) {
      throw new Error('PostgreSQL required in CI but isolated database setup failed');
    }
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('applies 005 on PostgreSQL and keeps commercial monitor_jobs separate', async () => {
    if (!sql) return;
    const applied = await runMigrations(sql);
    expect(applied.some((version) => version.startsWith('005_monitor_targets'))).toBe(true);
    const again = await runMigrations(sql);
    expect(again).toEqual([]);

    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'monitor_targets',
          'collector_jobs',
          'collector_runs',
          'collector_heartbeats',
          'monitor_jobs'
        )
    `;
    const names = tables.map((row) => row.table_name).sort();
    expect(names).toEqual([
      'collector_heartbeats',
      'collector_jobs',
      'collector_runs',
      'monitor_jobs',
      'monitor_targets',
    ]);

    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname = 'monitor_targets_active_identity'
    `;
    expect(indexes).toHaveLength(1);

    const [jobColumns] = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'monitor_jobs' AND column_name = 'project_id'
    `;
    expect(jobColumns?.column_name).toBe('project_id');
  });
});
