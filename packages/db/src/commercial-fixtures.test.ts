import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSql } from './client';
import { countCommercialFixtureRows, seedCommercialFixtures } from './commercial-fixtures';
import { runMigrations } from './migrate';
import { postgresAvailable } from './postgres-available';

describe('commercial fixtures', () => {
  let sql: ReturnType<typeof createSql> | null = null;

  beforeAll(async () => {
    if (!(await postgresAvailable())) return;
    sql = createSql();
    await runMigrations(sql);
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  test('seed is idempotent for fixture table counts', async () => {
    if (!sql) return;
    await seedCommercialFixtures(sql);
    const afterFirst = await countCommercialFixtureRows(sql);
    expect(afterFirst.commercialProjects).toBe(13);
    expect(afterFirst.projectWorkflows).toBe(13);
    expect(afterFirst.wfNodes).toBe(169);
    expect(afterFirst.wfEdges).toBe(169);
    expect(afterFirst.wfPackages).toBe(13);
    expect(afterFirst.openItems).toBe(5);
    expect(afterFirst.publishRecords).toBe(5);
    expect(afterFirst.monitorContracts).toBe(1);
    expect(afterFirst.hermesProposals).toBe(1);

    await seedCommercialFixtures(sql);
    const afterSecond = await countCommercialFixtureRows(sql);
    expect(afterSecond).toEqual(afterFirst);
  });
});
