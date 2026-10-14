import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Sql } from './client';
import {
  countCommercialFixtureRows,
  expectedCommercialFixtureCounts,
  seedCommercialFixtures,
} from './commercial-fixtures';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';

describe('commercial fixtures', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let expected: Awaited<ReturnType<typeof expectedCommercialFixtureCounts>> | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    expected = await expectedCommercialFixtureCounts(sql);
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('seed is idempotent for fixture table counts', async () => {
    if (!sql || !expected) return;

    await seedCommercialFixtures(sql);
    const afterFirst = await countCommercialFixtureRows(sql);
    expect(afterFirst).toEqual(expected);

    await seedCommercialFixtures(sql);
    const afterSecond = await countCommercialFixtureRows(sql);
    expect(afterSecond).toEqual(expected);
    expect(afterSecond).toEqual(afterFirst);
  });
});
