import { afterAll, describe, expect, test } from 'bun:test';
import {
  createEmptyIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  runMigrations,
} from '@studio/db';
import { createLogger } from './logger';

describe('postgres log sink', () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const name of created) {
      await dropIsolatedTestDatabase(name).catch(() => undefined);
    }
  });

  test('persists a warn line without the secret values', async () => {
    const isolated = await createEmptyIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql = isolated.sql;
    try {
      await runMigrations(sql);
      const lines: string[] = [];
      const logger = createLogger({
        service: 'api',
        instance: 'sink-test',
        envName: 'test',
        sql,
        destination: (line) => lines.push(line),
      });
      const runId = '11111111-1111-4111-8111-111111111111';
      logger.error(
        'SESSDATA=plain-sess-value-9f3a; bili_jct=plain-jct-value-9f3a Bearer abc.def-GHI_9',
        {
          event: 'http.error',
          runId,
          context: { password: 'pw-secret-value', note: 'visible' },
        },
      );
      logger.info('not stored', { event: 'http.request' });
      await logger.flush();
      const rows = await sql<
        { message: string; event: string | null; context: { note?: string } }[]
      >`
        SELECT message, event, context FROM app_logs
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.event).toBe('http.error');
      expect(rows[0]?.context.note).toBe('visible');
      const stored = JSON.stringify(rows);
      expect(stored).not.toContain('plain-sess-value-9f3a');
      expect(stored).not.toContain('plain-jct-value-9f3a');
      expect(stored).not.toContain('abc.def-GHI_9');
      expect(stored).not.toContain('pw-secret-value');
      expect(stored).not.toMatch(/SESSDATA|bili_jct|password|ciphertext/);
      expect(lines.join('\n')).not.toContain('plain-sess-value-9f3a');
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 30_000);
});
