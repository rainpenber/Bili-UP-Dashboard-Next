import { afterAll, describe, expect, test } from 'bun:test';
import { migrationSql } from './real-collector';
import { runMigrations } from './migrate';
import { createEmptyIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';

describe('real collector migration', () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const name of created) {
      await dropIsolatedTestDatabase(name).catch(() => undefined);
    }
  });

  test('keeps an existing sample when 006 is applied again', async () => {
    const isolated = await createEmptyIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql = isolated.sql;
    try {
      await runMigrations(sql);
      await sql`INSERT INTO videos (bvid, title) VALUES ('BV1xx411c7mD', '旧视频')`;
      await sql`
        INSERT INTO video_metric_samples (
          bvid, sampled_at, source_timezone, raw_time, timestamp_precision, view_count
        ) VALUES (
          'BV1xx411c7mD', '2026-01-01T00:00:00Z', 'Asia/Shanghai', '2026-01-01 08:00', 'minute', 3
        )
      `;
      await sql.unsafe(migrationSql('006_real_collector'));
      const [sample] = await sql<{ source: string; comment_count: string | null }[]>`
        SELECT source, comment_count::text AS comment_count
        FROM video_metric_samples
        WHERE bvid = 'BV1xx411c7mD'
      `;
      expect(sample?.source).toBe('import');
      expect(sample?.comment_count).toBeNull();

      const [video] = await sql<{ cid: string | null }[]>`
        SELECT cid::text AS cid FROM videos WHERE bvid = 'BV1xx411c7mD'
      `;
      expect(video?.cid ?? null).toBeNull();

      await sql`
        INSERT INTO monitor_targets (id, "type", external_id, interval_minutes, source)
        VALUES (${crypto.randomUUID()}::uuid, 'video', 'BV1xx411c7mE', 60, 'bilibili')
      `;
      const rejectedSource = await sql`
        INSERT INTO monitor_targets (id, "type", external_id, interval_minutes, source)
        VALUES (${crypto.randomUUID()}::uuid, 'video', 'BV1xx411c7mF', 60, 'other')
      `.catch((error: unknown) => error);
      if (!(rejectedSource instanceof Error)) throw new Error('非法 source 应当被拒绝');

      const first = crypto.randomUUID();
      const second = crypto.randomUUID();
      await sql`
        INSERT INTO bili_accounts (id, status, is_default) VALUES (${first}::uuid, 'active', true)
      `;
      const duplicate = await sql`
        INSERT INTO bili_accounts (id, status, is_default)
        VALUES (${second}::uuid, 'active', true)
      `.catch((error: unknown) => error);
      expect(duplicate).toBeInstanceOf(Error);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 30_000);

  test('runMigrations records 006 once', async () => {
    const isolated = await createEmptyIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    try {
      const applied = await runMigrations(isolated.sql);
      expect(applied.some((version) => version.startsWith('006_real_collector'))).toBe(true);
      expect(await runMigrations(isolated.sql)).toEqual([]);
      const tables = await isolated.sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'bili_accounts',
            'bili_account_secrets',
            'bili_login_sessions',
            'collector_requests',
            'collector_circuits'
          )
      `;
      expect(tables.map((row) => row.table_name).sort()).toEqual([
        'bili_account_secrets',
        'bili_accounts',
        'bili_login_sessions',
        'collector_circuits',
        'collector_requests',
      ]);
    } finally {
      await isolated.sql.end({ timeout: 5 });
    }
  });
});
