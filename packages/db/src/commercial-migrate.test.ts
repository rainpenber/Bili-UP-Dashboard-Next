import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Sql } from './client';
import { runMigrations } from './migrate';
import { assertIntegrationSql, isPostgresRequiredEnv } from './require-postgres';
import { createEmptyIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';

describe('commercial migrations', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createEmptyIsolatedTestDatabase();
    if (!isolated && isPostgresRequiredEnv()) {
      throw new Error('PostgreSQL required in CI but isolated database setup failed');
    }
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('runMigrations is idempotent and seeds default template once', async () => {
    assertIntegrationSql(sql);
    const first = await runMigrations(sql);
    expect(first.some((v) => v.startsWith('004_commercial'))).toBe(true);

    const [countsAfterFirst] = await sql<{ nodes: string; edges: string; versions: string }[]>`
      SELECT
        (SELECT count(*)::text FROM wf_template_nodes WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111') AS nodes,
        (SELECT count(*)::text FROM wf_template_edges WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111') AS edges,
        (SELECT count(*)::text FROM wf_template_versions) AS versions
    `;
    expect(Number(countsAfterFirst?.nodes)).toBe(13);
    expect(Number(countsAfterFirst?.edges)).toBe(15);

    const second = await runMigrations(sql);
    expect(second.length).toBe(0);

    const [countsAfterSecond] = await sql<{ nodes: string; edges: string }[]>`
      SELECT
        (SELECT count(*)::text FROM wf_template_nodes WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111') AS nodes,
        (SELECT count(*)::text FROM wf_template_edges WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111') AS edges
    `;
    expect(countsAfterSecond?.nodes).toBe(countsAfterFirst?.nodes);
    expect(countsAfterSecond?.edges).toBe(countsAfterFirst?.edges);
  });
});
