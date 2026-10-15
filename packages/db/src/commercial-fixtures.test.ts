import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Sql } from './client';
import {
  FIXTURE_PROJECT_IDS,
  countCommercialFixtureRows,
  expectedCommercialFixtureCounts,
  seedCommercialFixtures,
} from './commercial-fixtures';
import { assertIntegrationSql, isPostgresRequiredEnv } from './require-postgres';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';

describe('commercial fixtures', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let expected: Awaited<ReturnType<typeof expectedCommercialFixtureCounts>> | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated && isPostgresRequiredEnv()) {
      throw new Error('PostgreSQL required in CI but isolated database setup failed');
    }
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (sql) {
      expected = await expectedCommercialFixtureCounts(sql);
    }
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('seed is idempotent for fixture table counts', async () => {
    assertIntegrationSql(sql);
    if (!expected) throw new Error('expected fixture counts not computed');

    await seedCommercialFixtures(sql);
    const afterFirst = await countCommercialFixtureRows(sql);
    expect(afterFirst).toEqual(expected);

    await seedCommercialFixtures(sql);
    const afterSecond = await countCommercialFixtureRows(sql);
    expect(afterSecond).toEqual(expected);
    expect(afterSecond).toEqual(afterFirst);

    const [mergeNodes] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c
      FROM wf_nodes
      WHERE project_id = ANY(${Object.values(FIXTURE_PROJECT_IDS)})
        AND kind = 'merge'
        AND name = '汇合节点'
    `;
    expect(Number(mergeNodes?.c)).toBe(expected.commercialProjects);
  }, 30_000);
});
