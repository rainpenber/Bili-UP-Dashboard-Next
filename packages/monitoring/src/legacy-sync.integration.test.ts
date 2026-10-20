import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createWriteStream } from 'node:fs';
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@studio/observability';
import {
  countLegacySyncLocks,
  createIsolatedTestDatabase,
  createSql,
  dropIsolatedTestDatabase,
  isPostgresRequiredEnv,
  readDbConfigFromEnv,
  acquireLegacySyncLock,
  readLegacyCheckpoint,
  readLegacySyncStatus,
  type Sql,
} from '@studio/db';
import { importLegacyDirectory } from './legacy-import';
import { runLegacyCsvSync } from './legacy-sync';

const FAN = '1030924321_follower.csv';
const VIDEO = 'BV1xx411c7mH_views.csv';
const FAN_HEADER = '时间,粉丝数\n';
const VIDEO_HEADER = '时间,播放量,在线观看人数,点赞,投币,收藏,分享,弹幕\n';

function fanLine(time: string, count: number | string): string {
  return `${time},${count}\n`;
}

function videoLine(time: string, view: number | string, online = '6'): string {
  return `${time},${view},${online},13,10,2,0,0\n`;
}

describe('legacy csv sync', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) {
      if (isPostgresRequiredEnv()) {
        throw new Error('PostgreSQL required in CI but isolated database setup failed');
      }
      return;
    }
    sql = isolated.sql;
    databaseName = isolated.databaseName;
  });

  afterAll(async () => {
    if (!sql || !databaseName) return;
    await sql.end({ timeout: 5 });
    await dropIsolatedTestDatabase(databaseName);
  });

  beforeEach(async () => {
    if (!sql) return;
    await sql`
      TRUNCATE
        legacy_csv_sync_rounds,
        legacy_csv_sync_checkpoints,
        import_conflicts_or_rejects,
        creator_follower_samples,
        video_metric_samples,
        import_batches,
        videos,
        creators,
        app_logs
      RESTART IDENTITY CASCADE
    `;
  });

  test('imports once, skips an unchanged file, then appends one late row', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-'));
    try {
      writeFileSync(
        join(dir, FAN),
        `${FAN_HEADER}${fanLine('2026-04-25 22:03', 30)}${fanLine('2026-04-25 22:04', 40)}`,
      );
      const first = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(first.status).toBe('succeeded');
      expect(first.inserted).toBe(2);
      expect(first.files[0]?.action).toBe('imported');
      const again = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(again.status).toBe('succeeded');
      expect(again.rowsParsed).toBe(0);
      expect(again.inserted).toBe(0);
      expect(again.filesSkipped).toBe(1);
      expect(again.files[0]?.action).toBe('skipped');
      const batchesAfterSkip = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM import_batches
      `;
      appendFileSync(join(dir, FAN), fanLine('2026-04-25 22:01', 10));
      const appended = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(appended.rowsParsed).toBe(1);
      expect(appended.inserted).toBe(1);
      expect(appended.files[0]?.action).toBe('appended');
      const rows = await sql<{ sampled_at: Date; follower_count: string; source: string }[]>`
        SELECT sampled_at, follower_count::text AS follower_count, source
        FROM creator_follower_samples
        ORDER BY sampled_at
      `;
      expect(rows.map((row) => row.follower_count)).toEqual(['10', '30', '40']);
      expect(rows.every((row) => row.source === 'legacy_csv')).toBe(true);
      const batches = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM import_batches`;
      expect(batches[0]?.n).toBe((batchesAfterSkip[0]?.n ?? 0) + 1);
      const status = await readLegacySyncStatus(sql);
      expect(status.status).toBe('succeeded');
      expect(status.inserted).toBe(1);
      expect(status.lastSuccessAt).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not reimport a file with hundreds of thousands of rows', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-large-'));
    const path = join(dir, FAN);
    const lines = 200_000;
    try {
      const stream = createWriteStream(path);
      stream.write(FAN_HEADER);
      const base = Date.UTC(2020, 0, 1);
      let pending = '';
      for (let index = 0; index < lines; index += 1) {
        const wall = new Date(base + index * 60_000 + 8 * 3_600_000);
        const stamp = [
          wall.getUTCFullYear(),
          String(wall.getUTCMonth() + 1).padStart(2, '0'),
          String(wall.getUTCDate()).padStart(2, '0'),
        ].join('-');
        const clock = `${String(wall.getUTCHours()).padStart(2, '0')}:${String(wall.getUTCMinutes()).padStart(2, '0')}`;
        pending += `${stamp} ${clock},${1000 + (index % 50)}\n`;
        if (pending.length > 1_048_576) {
          if (!stream.write(pending)) await once(stream, 'drain');
          pending = '';
        }
      }
      if (pending.length > 0) stream.write(pending);
      stream.end();
      await once(stream, 'finish');
      let parsed = 0;
      const first = await runLegacyCsvSync({
        sql,
        dir,
        execute: true,
        once: true,
        batchLines: 5000,
        onParsed: (info) => {
          parsed += info.rows;
        },
      });
      expect(first.inserted).toBe(lines);
      expect(parsed).toBe(lines);
      const before = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM import_batches`;
      parsed = 0;
      const second = await runLegacyCsvSync({
        sql,
        dir,
        execute: true,
        once: true,
        batchLines: 5000,
        onParsed: (info) => {
          parsed += info.rows;
        },
      });
      expect(second.rowsParsed).toBe(0);
      expect(second.inserted).toBe(0);
      expect(second.files[0]?.action).toBe('skipped');
      expect(parsed).toBe(0);
      const after = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM import_batches`;
      expect(after[0]?.n).toBe(before[0]?.n);
      appendFileSync(path, fanLine('2019-12-31 23:59', 7));
      parsed = 0;
      const third = await runLegacyCsvSync({
        sql,
        dir,
        execute: true,
        once: true,
        onParsed: (info) => {
          parsed += info.rows;
        },
      });
      expect(parsed).toBe(1);
      expect(third.inserted).toBe(1);
      const total = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM creator_follower_samples
      `;
      expect(total[0]?.n).toBe(lines + 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  test('waits for an incomplete tail, including a CRLF split and a partial UTF-8 byte', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-tail-'));
    const path = join(dir, FAN);
    try {
      writeFileSync(
        path,
        Buffer.from(`${FAN_HEADER}${fanLine('2026-04-25 22:01', 10)}2026-04-25 22:02,11`, 'utf8'),
      );
      const partial = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(partial.inserted).toBe(1);
      appendFileSync(path, Buffer.from('\n2026-04-25 22:03,13\n', 'utf8'));
      const completed = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(completed.inserted).toBe(2);
      const crlfName = '1030924322_follower.csv';
      const crlf = mkdtempSync(join(tmpdir(), 'legacy-sync-crlf-'));
      const crlfPath = join(crlf, crlfName);
      writeFileSync(crlfPath, Buffer.from('时间,粉丝数\r\n2026-04-25 22:01,10\r', 'utf8'));
      const held = await runLegacyCsvSync({ sql, dir: crlf, execute: true, once: true });
      expect(held.inserted).toBe(0);
      const heldOffset = (await readLegacyCheckpoint(sql, crlfName))?.byteOffset ?? 0;
      expect(heldOffset).toBe(Buffer.byteLength('时间,粉丝数\r\n'));
      appendFileSync(crlfPath, Buffer.from('\n2026-04-25 22:02,12\r\n', 'utf8'));
      const released = await runLegacyCsvSync({ sql, dir: crlf, execute: true, once: true });
      expect(released.inserted).toBe(2);
      const utfName = '1030924323_follower.csv';
      const utf = mkdtempSync(join(tmpdir(), 'legacy-sync-utf8-'));
      const utfPath = join(utf, utfName);
      const complete = Buffer.from(`${FAN_HEADER}${fanLine('2026-04-25 22:05', 15)}`, 'utf8');
      writeFileSync(utfPath, Buffer.concat([complete, Buffer.from([0xe5])]));
      await runLegacyCsvSync({ sql, dir: utf, execute: true, once: true });
      const during = await readLegacyCheckpoint(sql, utfName);
      expect(during?.byteOffset).toBe(complete.length);
      appendFileSync(
        utfPath,
        Buffer.concat([Buffer.from([0x8d, 0x81]), Buffer.from('\n', 'utf8')]),
      );
      const rejected = await runLegacyCsvSync({ sql, dir: utf, execute: true, once: true });
      expect(rejected.rejected).toBe(1);
      const count = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM creator_follower_samples WHERE mid = 1030924323
      `;
      expect(count[0]?.n).toBe(1);
      rmSync(crlf, { recursive: true, force: true });
      rmSync(utf, { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('records one illegal line and does not repeat it', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-bad-'));
    try {
      writeFileSync(
        join(dir, FAN),
        `${FAN_HEADER}${fanLine('2026-04-25 22:01', 10)}not-a-time,5\n${fanLine('2026-04-25 22:03', 12)}`,
      );
      const first = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(first.inserted).toBe(2);
      expect(first.rejected).toBe(1);
      const second = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(second.rejected).toBe(0);
      expect(second.rowsParsed).toBe(0);
      const rejects = await sql<{ n: number; line: string }[]>`
        SELECT count(*)::int AS n, min(detail->>'line') AS line
        FROM import_conflicts_or_rejects
        WHERE kind = 'rejected_row'
      `;
      expect(rejects[0]?.n).toBe(1);
      expect(rejects[0]?.line).toContain('not-a-time');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails clearly on a changed or missing header and keeps stored samples', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-header-'));
    const path = join(dir, FAN);
    try {
      writeFileSync(path, `${FAN_HEADER}${fanLine('2026-04-25 22:01', 10)}`);
      expect((await runLegacyCsvSync({ sql, dir, execute: true, once: true })).status).toBe(
        'succeeded',
      );
      const checkpoint = await readLegacyCheckpoint(sql, FAN);
      writeFileSync(path, `时间,别的\n${fanLine('2026-04-25 22:01', 99)}`);
      const changed = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(changed.status).toBe('failed');
      expect(changed.error).toContain('header_changed');
      expect((await readLegacyCheckpoint(sql, FAN))?.byteOffset).toBe(checkpoint?.byteOffset);
      const kept = await sql<{ follower_count: string }[]>`
        SELECT follower_count::text AS follower_count FROM creator_follower_samples
      `;
      expect(kept[0]?.follower_count).toBe('10');
      writeFileSync(path, Buffer.from('时间,粉丝数', 'utf8'));
      const missing = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(missing.status).toBe('failed');
      expect(missing.error).toContain('header_missing');
      expect((await readLegacyCheckpoint(sql, FAN))?.byteOffset).toBe(checkpoint?.byteOffset);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rescans truncation and same-size replacement without deleting samples', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-rewrite-'));
    const path = join(dir, FAN);
    try {
      writeFileSync(
        path,
        `${FAN_HEADER}${fanLine('2026-04-25 22:01', 100)}${fanLine('2026-04-25 22:02', 101)}${fanLine('2026-04-25 22:03', 102)}`,
      );
      await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      writeFileSync(path, `${FAN_HEADER}${fanLine('2026-04-25 22:01', 100)}`);
      const truncated = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(truncated.files[0]?.action).toBe('rescanned');
      const afterTruncate = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM creator_follower_samples
      `;
      expect(afterTruncate[0]?.n).toBe(3);
      const checkpoint = await readLegacyCheckpoint(sql, FAN);
      const size = Buffer.byteLength(`${FAN_HEADER}${fanLine('2026-04-25 22:01', 100)}`);
      expect(checkpoint?.byteOffset).toBe(size);
      const replaced = `${FAN_HEADER}${fanLine('2026-04-25 22:09', 100)}`;
      expect(Buffer.byteLength(replaced)).toBe(size);
      writeFileSync(path, replaced);
      const rotated = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(rotated.files[0]?.action).toBe('rescanned');
      expect(rotated.inserted).toBe(1);
      const values = await sql<{ follower_count: string; raw_time: string }[]>`
        SELECT follower_count::text AS follower_count, raw_time
        FROM creator_follower_samples
        ORDER BY sampled_at
      `;
      expect(values.map((row) => row.raw_time)).toEqual([
        '2026-04-25 22:01',
        '2026-04-25 22:02',
        '2026-04-25 22:03',
        '2026-04-25 22:09',
      ]);
      expect(values[0]?.follower_count).toBe('100');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not treat a missing snapshot as success and does not delete rows', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-missing-'));
    const path = join(dir, FAN);
    try {
      writeFileSync(path, `${FAN_HEADER}${fanLine('2026-04-25 22:01', 10)}`);
      await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      rmSync(path);
      const missingFile = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(missingFile.status).toBe('failed');
      expect(missingFile.error).toContain('source_missing');
      expect(
        (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM creator_follower_samples`)[0]?.n,
      ).toBe(1);
      rmSync(dir, { recursive: true, force: true });
      const missingDir = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(missingDir.status).toBe('failed');
      expect(missingDir.error).toBe('snapshot_dir_missing');
      expect(
        (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM creator_follower_samples`)[0]?.n,
      ).toBe(1);
      expect(
        (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM legacy_csv_sync_checkpoints`)[0]
          ?.n,
      ).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('one of two sync processes is busy and samples are not doubled', async () => {
    if (!sql || !databaseName) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-race-'));
    const other = createSql({ ...readDbConfigFromEnv(), database: databaseName });
    try {
      writeFileSync(pathOf(dir), `${FAN_HEADER}${fanLine('2026-04-25 22:01', 10)}`);
      const held = await acquireLegacySyncLock(sql);
      expect(held).not.toBeNull();
      const denied = await acquireLegacySyncLock(other);
      expect(denied).toBeNull();
      await held?.release();
      let releaseHold: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        releaseHold = resolve;
      });
      let markEntered: () => void = () => undefined;
      const entered = new Promise<void>((resolve) => {
        markEntered = resolve;
      });
      const firstPromise = runLegacyCsvSync({
        sql,
        dir,
        execute: true,
        once: true,
        hooks: {
          beforeBatchCommit: async () => {
            markEntered();
            await hold;
          },
        },
      });
      await entered;
      const second = await runLegacyCsvSync({ sql: other, dir, execute: true, once: true });
      expect(second.status).toBe('busy');
      releaseHold();
      const first = await firstPromise;
      expect(first.status).toBe('succeeded');
      expect(first.inserted).toBe(1);
      expect(
        (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM creator_follower_samples`)[0]?.n,
      ).toBe(1);
      expect(await countLegacySyncLocks(sql)).toBe(0);
    } finally {
      await other.end({ timeout: 5 });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a rolled-back batch does not advance the checkpoint', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-abort-'));
    const path = join(dir, FAN);
    try {
      writeFileSync(
        path,
        `${FAN_HEADER}${fanLine('2026-04-25 22:01', 1)}${fanLine('2026-04-25 22:02', 2)}${fanLine('2026-04-25 22:03', 3)}${fanLine('2026-04-25 22:04', 4)}${fanLine('2026-04-25 22:05', 5)}`,
      );
      const size = Buffer.byteLength(
        `${FAN_HEADER}${fanLine('2026-04-25 22:01', 1)}${fanLine('2026-04-25 22:02', 2)}${fanLine('2026-04-25 22:03', 3)}${fanLine('2026-04-25 22:04', 4)}${fanLine('2026-04-25 22:05', 5)}`,
      );
      const interrupted = await runLegacyCsvSync({
        sql,
        dir,
        execute: true,
        once: true,
        batchLines: 2,
        hooks: {
          beforeBatchCommit: ({ batchIndex }) => {
            if (batchIndex === 2) throw new Error('interrupt');
          },
        },
      });
      expect(interrupted.status).toBe('failed');
      expect(interrupted.error).toContain('interrupt');
      const checkpoint = await readLegacyCheckpoint(sql, FAN);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.byteOffset).toBeLessThan(size);
      expect(
        (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM creator_follower_samples`)[0]?.n,
      ).toBe(2);
      const retried = await runLegacyCsvSync({
        sql,
        dir,
        execute: true,
        once: true,
        batchLines: 2,
      });
      expect(retried.status).toBe('succeeded');
      expect(
        (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM creator_follower_samples`)[0]?.n,
      ).toBe(5);
      expect((await readLegacyCheckpoint(sql, FAN))?.byteOffset).toBe(size);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('keeps an existing bilibili sample, title, face, and cover', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-live-'));
    try {
      await sql`
        INSERT INTO creators (mid, uname, face_asset_id, monitoring_enabled)
        VALUES (1030924321, '保持昵称', 'face-1', false)
      `;
      await sql`
        INSERT INTO videos (bvid, title, cover_asset_id, mid, monitoring_enabled)
        VALUES ('BV1xx411c7mH', '保持标题', 'cover-1', 1030924321, false)
      `;
      await sql`
        INSERT INTO video_metric_samples (
          bvid, sampled_at, source_timezone, raw_time, timestamp_precision,
          view_count, online_viewers, like_count, coin_count, favorite_count, share_count,
          danmaku_count, comment_count, source
        ) VALUES (
          'BV1xx411c7mH', '2026-04-25 22:01+08', 'Asia/Shanghai', '2026-04-25 22:01', 'minute',
          999, 4, 8, 7, 6, 5, 3, 7, 'bilibili'
        )
      `;
      await sql`
        INSERT INTO creator_follower_samples (
          mid, sampled_at, source_timezone, raw_time, timestamp_precision, follower_count, source
        ) VALUES (
          1030924321, '2026-04-25 22:01+08', 'Asia/Shanghai', '2026-04-25 22:01', 'minute', 1, 'bilibili'
        )
      `;
      writeFileSync(
        join(dir, VIDEO),
        `\uFEFF${VIDEO_HEADER.replace('\n', '\r\n')}${videoLine('2026-04-25 22:01', 88).replace('\n', '\r\n')}${videoLine('2026-04-25 22:11', 90, '1234+').replace('\n', '\r\n')}`,
      );
      writeFileSync(
        join(dir, FAN),
        `${FAN_HEADER}${fanLine('2026-04-25 22:01', 34221)}${fanLine('2026-04-25 22:11', 34222)}`,
      );
      const report = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(report.status).toBe('succeeded');
      expect(report.inserted).toBe(2);
      expect(report.conflicts).toBe(2);
      const [video] = await sql<
        {
          view_count: string;
          comment_count: string | null;
          source: string;
          online_viewers: string;
          online_viewers_raw: string | null;
          title: string;
          cover_asset_id: string;
          monitoring_enabled: boolean;
          mid: string;
        }[]
      >`
        SELECT s.view_count::text AS view_count, s.comment_count::text AS comment_count, s.source,
          s.online_viewers::text AS online_viewers, s.online_viewers_raw, v.title, v.cover_asset_id,
          v.monitoring_enabled, v.mid::text AS mid
        FROM video_metric_samples s
        JOIN videos v ON v.bvid = s.bvid
        WHERE s.bvid = 'BV1xx411c7mH' AND s.sampled_at = '2026-04-25 22:01+08'
      `;
      expect(video?.view_count).toBe('999');
      expect(video?.comment_count).toBe('7');
      expect(video?.source).toBe('bilibili');
      expect(video?.online_viewers).toBe('4');
      expect(video?.title).toBe('保持标题');
      expect(video?.cover_asset_id).toBe('cover-1');
      expect(video?.monitoring_enabled).toBe(false);
      expect(video?.mid).toBe('1030924321');
      const [legacyVideo] = await sql<
        {
          comment_count: string | null;
          source: string;
          online_viewers: string;
          online_viewers_raw: string | null;
        }[]
      >`
        SELECT comment_count::text AS comment_count, source,
          online_viewers::text AS online_viewers, online_viewers_raw
        FROM video_metric_samples
        WHERE bvid = 'BV1xx411c7mH' AND sampled_at = '2026-04-25 22:11+08'
      `;
      expect(legacyVideo?.comment_count).toBeNull();
      expect(legacyVideo?.source).toBe('legacy_csv');
      expect(legacyVideo?.online_viewers).toBe('1234');
      expect(legacyVideo?.online_viewers_raw).toBe('1234+');
      const [creator] = await sql<
        { uname: string; face_asset_id: string; follower_count: string; source: string }[]
      >`
        SELECT c.uname, c.face_asset_id, s.follower_count::text AS follower_count, s.source
        FROM creator_follower_samples s
        JOIN creators c ON c.mid = s.mid
        WHERE s.mid = 1030924321 AND s.sampled_at = '2026-04-25 22:01+08'
      `;
      expect(creator?.uname).toBe('保持昵称');
      expect(creator?.face_asset_id).toBe('face-1');
      expect(creator?.follower_count).toBe('1');
      expect(creator?.source).toBe('bilibili');
      const both = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM video_metric_samples WHERE bvid = 'BV1xx411c7mH'
      `;
      expect(both[0]?.n).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('dry-run writes nothing, --once does not poll, and stopping a poll releases the lock', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-dry-'));
    try {
      writeFileSync(pathOf(dir), `${FAN_HEADER}${fanLine('2026-04-25 22:01', 10)}`);
      let slept = false;
      const dry = await runLegacyCsvSync({
        sql,
        dir,
        execute: false,
        once: true,
        sleep: async () => {
          slept = true;
        },
      });
      expect(dry.status).toBe('dry_run');
      expect(dry.inserted).toBe(1);
      expect(slept).toBe(false);
      const writes = await sql<
        { checkpoints: number; samples: number; batches: number; rounds: number; logs: number }[]
      >`
        SELECT
          (SELECT count(*)::int FROM legacy_csv_sync_checkpoints) AS checkpoints,
          (SELECT count(*)::int FROM creator_follower_samples) AS samples,
          (SELECT count(*)::int FROM import_batches) AS batches,
          (SELECT count(*)::int FROM legacy_csv_sync_rounds) AS rounds,
          (SELECT count(*)::int FROM app_logs) AS logs
      `;
      expect(writes[0]).toEqual({ checkpoints: 0, samples: 0, batches: 0, rounds: 0, logs: 0 });
      const controller = new AbortController();
      let sleeps = 0;
      const polled = await runLegacyCsvSync({
        sql,
        dir,
        execute: true,
        once: false,
        intervalMs: 10,
        signal: controller.signal,
        sleep: async () => {
          sleeps += 1;
          controller.abort();
        },
      });
      expect(polled.status).toBe('succeeded');
      expect(sleeps).toBe(1);
      expect(await countLegacySyncLocks(sql)).toBe(0);
      const logger = createLogger({ service: 'collector', sql, instance: 'legacy-sync-test' });
      await runLegacyCsvSync({ sql, dir, execute: true, once: true, logger });
      await logger.flush();
      const events = await sql<{ event: string; inserted: number | null }[]>`
        SELECT event, (context->>'inserted')::int AS inserted
        FROM app_logs
        WHERE COALESCE(event, '') ILIKE '%legacy.sync%'
        ORDER BY id
      `;
      expect(events.map((row) => row.event)).toContain('legacy.sync.finished');
      const status = await readLegacySyncStatus(sql);
      expect(status.lastSuccessAt).not.toBeNull();
      expect(status.filesSkipped).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('import-legacy still applies without checkpoints, and sync does not overwrite it', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-compat-'));
    try {
      writeFileSync(pathOf(dir), `${FAN_HEADER}${fanLine('2026-04-25 22:01', 10)}`);
      const imported = await importLegacyDirectory(sql, dir);
      expect(imported.files[0]?.inserted).toBe(1);
      expect(
        (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM legacy_csv_sync_checkpoints`)[0]
          ?.n,
      ).toBe(0);
      const synced = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(synced.inserted).toBe(0);
      expect(synced.conflicts).toBe(1);
      const [row] = await sql<{ follower_count: string; source: string }[]>`
        SELECT follower_count::text AS follower_count, source FROM creator_follower_samples
      `;
      expect(row?.follower_count).toBe('10');
      expect(row?.source).toBe('legacy_csv');
      const repeat = await importLegacyDirectory(sql, dir);
      expect(repeat.files[0]?.inserted).toBe(0);
      expect(repeat.files[0]?.conflicts).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a snapshot replaced after validation writes no swapped sample and keeps the other file', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-swap-'));
    const bad = 'BV1aaaaaaaaa_views.csv';
    const good = 'BV1aaaaaaaab_views.csv';
    const badPath = join(dir, bad);
    const originalHeader = '时间,播放量,在线观看人数,点赞,投币,收藏,分享,弹幕';
    const swappedHeader = '时间,点赞   ,在线观看人数,播放,投币,收藏,分享,弹幕';
    const first = '2026-04-25 22:01,100,6,5,1,1,1,1\n';
    const appended = '2026-04-25 22:02,900,6,20,1,1,1,1\n';
    const swapped = '2026-04-25 22:02,20,6,900,1,1,1,1\n';
    try {
      expect(Buffer.byteLength(originalHeader)).toBe(Buffer.byteLength(swappedHeader));
      expect(Buffer.byteLength(appended)).toBe(Buffer.byteLength(swapped));
      writeFileSync(badPath, `${originalHeader}\n${first}`);
      await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      const checkpoint = await readLegacyCheckpoint(sql, bad);
      writeFileSync(badPath, `${originalHeader}\n${first}${appended}`);
      writeFileSync(join(dir, good), `${VIDEO_HEADER}${videoLine('2026-04-25 22:01', 7)}`);
      const report = await runLegacyCsvSync({
        sql,
        dir,
        execute: true,
        once: true,
        hooks: {
          afterPlan: ({ file, filePath }) => {
            if (file !== bad) return;
            const next = `${filePath}.next`;
            writeFileSync(next, `${swappedHeader}\n${first}${swapped}`);
            renameSync(next, filePath);
          },
        },
      });
      const badReport = report.files.find((file) => file.file === bad);
      const goodReport = report.files.find((file) => file.file === good);
      expect(badReport?.action).toBe('failed');
      expect(badReport?.error).toContain('header_changed');
      expect(badReport?.inserted).toBe(0);
      expect(goodReport?.action).toBe('imported');
      expect(goodReport?.inserted).toBe(1);
      const after = await readLegacyCheckpoint(sql, bad);
      expect(after?.byteOffset).toBe(checkpoint?.byteOffset);
      expect(after?.prefixSha256).toBe(checkpoint?.prefixSha256);
      const rows = await sql<{ view_count: string; like_count: string; bvid: string }[]>`
        SELECT bvid, view_count::text AS view_count, like_count::text AS like_count
        FROM video_metric_samples
        ORDER BY bvid, sampled_at
      `;
      expect(
        rows.map((row) => ({
          bvid: row.bvid,
          view_count: row.view_count,
          like_count: row.like_count,
        })),
      ).toEqual([
        { bvid: 'BV1aaaaaaaaa', view_count: '100', like_count: '5' },
        { bvid: 'BV1aaaaaaaab', view_count: '7', like_count: '13' },
      ]);
      const again = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(again.files.find((file) => file.file === bad)?.error).toContain('header_changed');
      const still = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
        FROM video_metric_samples
        WHERE bvid = 'BV1aaaaaaaaa' AND view_count = 20 AND like_count = 900
      `;
      expect(still[0]?.n).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects 未知+ once and still imports the rest of the directory', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-bad-online-'));
    const first = 'BV1aaaaaaaaa_views.csv';
    const second = 'BV1aaaaaaaab_views.csv';
    try {
      writeFileSync(
        join(dir, first),
        `${VIDEO_HEADER}${videoLine('2026-04-25 22:01', 10)}${videoLine('2026-04-25 22:02', 11, '未知+')}${videoLine('2026-04-25 22:03', 12)}`,
      );
      writeFileSync(join(dir, second), `${VIDEO_HEADER}${videoLine('2026-04-25 22:01', 8)}`);
      const imported = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(imported.status).toBe('succeeded');
      expect(imported.inserted).toBe(3);
      expect(imported.rejected).toBe(1);
      expect(imported.filesSeen).toBe(2);
      const rejects = await sql<{ n: number; line: string }[]>`
        SELECT count(*)::int AS n, min(detail->>'line') AS line
        FROM import_conflicts_or_rejects
        WHERE kind = 'rejected_row'
      `;
      expect(rejects[0]?.n).toBe(1);
      expect(rejects[0]?.line).toContain('未知+');
      const views = await sql<{ bvid: string; view_count: string }[]>`
        SELECT bvid, view_count::text AS view_count
        FROM video_metric_samples
        ORDER BY bvid, sampled_at
      `;
      expect(views.map((row) => ({ bvid: row.bvid, view_count: row.view_count }))).toEqual([
        { bvid: 'BV1aaaaaaaaa', view_count: '10' },
        { bvid: 'BV1aaaaaaaaa', view_count: '12' },
        { bvid: 'BV1aaaaaaaab', view_count: '8' },
      ]);
      const repeat = await runLegacyCsvSync({ sql, dir, execute: true, once: true });
      expect(repeat.rejected).toBe(0);
      expect(repeat.rowsParsed).toBe(0);
      expect(repeat.files.every((file) => file.action === 'skipped')).toBe(true);
      const rejectsAgain = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM import_conflicts_or_rejects WHERE kind = 'rejected_row'
      `;
      expect(rejectsAgain[0]?.n).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a file read failure is counted and does not starve the next file', async () => {
    if (!sql) return;
    const dir = mkdtempSync(join(tmpdir(), 'legacy-sync-read-'));
    const blocked = 'BV1aaaaaaaaa_views.csv';
    const healthy = 'BV1aaaaaaaab_views.csv';
    try {
      writeFileSync(join(dir, blocked), `${VIDEO_HEADER}${videoLine('2026-04-25 22:01', 10)}`);
      writeFileSync(join(dir, healthy), `${VIDEO_HEADER}${videoLine('2026-04-25 22:01', 9)}`);
      const report = await runLegacyCsvSync({
        sql,
        dir,
        execute: true,
        once: true,
        hooks: {
          beforeRead: ({ file }) => {
            if (file !== blocked) return;
            throw Object.assign(new Error('snapshot unreadable'), { code: 'EIO', syscall: 'read' });
          },
        },
      });
      expect(report.status).toBe('failed');
      expect(report.filesSeen).toBe(2);
      expect(report.filesFailed).toBe(1);
      expect(report.inserted).toBe(1);
      expect(report.files.find((file) => file.file === blocked)?.error).toContain('read_failed');
      expect(report.files.find((file) => file.file === healthy)?.inserted).toBe(1);
      const rows = await sql<{ bvid: string }[]>`
        SELECT bvid FROM video_metric_samples ORDER BY bvid
      `;
      expect(rows.map((row) => row.bvid)).toEqual(['BV1aaaaaaaab']);
      expect(await readLegacyCheckpoint(sql, blocked)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function pathOf(dir: string): string {
  return join(dir, FAN);
}
