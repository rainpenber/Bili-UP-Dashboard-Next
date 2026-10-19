import { afterAll, describe, expect, test } from 'bun:test';
import {
  createEmptyIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  runMigrations,
} from '@studio/db';
import { pruneAppLogs } from './retention';

describe('app_logs retention', () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const name of created) {
      await dropIsolatedTestDatabase(name).catch(() => undefined);
    }
  });

  test('deletes rows older than the given number of days', async () => {
    const isolated = await createEmptyIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql = isolated.sql;
    try {
      await runMigrations(sql);
      const now = new Date('2026-10-19T00:00:00.000Z');
      await sql`
        INSERT INTO app_logs (ts, level, service, message)
        VALUES
          (${new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000)}, 'info', 'api', 'old'),
          (${new Date(now.getTime() - 24 * 60 * 60 * 1000)}, 'warn', 'collector', 'fresh')
      `;
      expect(await pruneAppLogs(sql, { retentionDays: 14, now })).toBe(1);
      const rows = await sql<{ message: string }[]>`SELECT message FROM app_logs ORDER BY message`;
      expect(rows.map((row) => row.message)).toEqual(['fresh']);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 30_000);
});
