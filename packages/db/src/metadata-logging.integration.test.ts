import { afterAll, describe, expect, test } from 'bun:test';
import { migrationSql } from './real-collector';
import { runMigrations } from './migrate';
import { createEmptyIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';

describe('metadata logging migration', () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const name of created) {
      await dropIsolatedTestDatabase(name).catch(() => undefined);
    }
  });

  test('applies 007 twice, rejects illegal states, and dedupes tags', async () => {
    const isolated = await createEmptyIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql = isolated.sql;
    try {
      const applied = await runMigrations(sql);
      expect(applied.some((version) => version.startsWith('007_metadata_assets_logs'))).toBe(true);
      expect((await runMigrations(sql)).length).toBe(0);
      await sql.unsafe(migrationSql('007_metadata_assets_logs'));
      await sql.unsafe(migrationSql('007_metadata_assets_logs'));

      const indexes = await sql<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'app_logs'
      `;
      const names = indexes.map((row) => row.indexname);
      expect(names).toContain('app_logs_ts_idx');
      expect(names).toContain('app_logs_level_ts_idx');
      expect(names).toContain('app_logs_run_idx');
      expect(names).toContain('app_logs_request_idx');

      await sql`INSERT INTO videos (bvid) VALUES ('BV1xx411c7mD')`;
      const [video] = await sql<{ cover_state: string; metadata_state: string }[]>`
        SELECT cover_state, metadata_state FROM videos WHERE bvid = 'BV1xx411c7mD'
      `;
      expect(video?.cover_state).toBe('pending');
      expect(video?.metadata_state).toBe('pending');
      const [partitionCols] = await sql<
        { tid: number | null; tid_v2: number | null; partition_name: string | null }[]
      >`
        SELECT tid, tid_v2, partition_name FROM videos WHERE bvid = 'BV1xx411c7mD'
      `;
      expect(partitionCols?.tid ?? null).toBeNull();
      expect(partitionCols?.tid_v2 ?? null).toBeNull();
      expect(partitionCols?.partition_name ?? null).toBeNull();
      const fakeName = await sql`
        UPDATE videos SET partition_name = '未知' WHERE bvid = 'BV1xx411c7mD'
      `.catch((error: unknown) => error);
      expect(fakeName).toBeInstanceOf(Error);
      const [dictionary] = await sql<{ present: boolean }[]>`
        SELECT to_regclass('public.bili_partitions') IS NOT NULL AS present
      `;
      expect(dictionary?.present).toBe(true);
      const badCover = await sql`
        UPDATE videos SET cover_state = 'bogus' WHERE bvid = 'BV1xx411c7mD'
      `.catch((error: unknown) => error);
      expect(badCover).toBeInstanceOf(Error);
      const badMeta = await sql`
        UPDATE videos SET metadata_state = 'bogus' WHERE bvid = 'BV1xx411c7mD'
      `.catch((error: unknown) => error);
      expect(badMeta).toBeInstanceOf(Error);

      await sql`INSERT INTO creators (mid) VALUES (7)`;
      const badCreator = await sql`
        UPDATE creators SET metadata_state = 'nope' WHERE mid = 7
      `.catch((error: unknown) => error);
      expect(badCreator).toBeInstanceOf(Error);

      await sql`
        INSERT INTO video_tags (bvid, tag, ordinal) VALUES ('BV1xx411c7mD', '测评', 0)
      `;
      const duplicate = await sql`
        INSERT INTO video_tags (bvid, tag, ordinal) VALUES ('BV1xx411c7mD', '测评', 1)
      `.catch((error: unknown) => error);
      expect(duplicate).toBeInstanceOf(Error);

      await sql`
        INSERT INTO app_logs (level, service, message) VALUES ('info', 'api', 'kept')
      `;
      const [kept] = await sql<{ message: string }[]>`SELECT message FROM app_logs`;
      expect(kept?.message).toBe('kept');
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 30_000);
});
