import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  insertMonitorTarget,
  readBiliAccountSecret,
  saveActiveBiliAccount,
  type Sql,
} from '@studio/db';
import { readBilibiliRuntimeConfig } from './bilibili-config';
import { createBilibiliProvider } from './bilibili-provider';
import { encryptCookieJar } from './credentials';
import { importLegacyDirectory } from './legacy-import';
import { installOfflineFetchGuard } from './network-guard';
import { createMonitorProvider, type MonitorProvider } from './offline-provider';
import { readCollectorConfig, runCollectorOnce } from './collector-runner';
import type { HttpTransport, TransportRequest } from './bilibili-transport';

installOfflineFetchGuard();

const pubdate = Math.floor(Date.now() / 1000) - 3600;

function viewBody(bvid: string, code = 0) {
  return {
    code,
    message: code === 0 ? '0' : 'no',
    data:
      code === 0
        ? {
            bvid,
            cid: 555,
            pubdate,
            title: '真实样本',
            pic: 'https://i0.hdslb.com/bfs/archive/example.jpg',
            owner: { mid: 42, name: 'UP' },
            stat: {
              view: 1000,
              danmaku: 10,
              reply: 7,
              favorite: 8,
              coin: 9,
              share: 3,
              like: 20,
            },
          }
        : null,
  };
}

function transportFor(mode: (bvid: string) => number): HttpTransport {
  return async (request: TransportRequest) => {
    const url = new URL(request.url);
    const bvid = url.searchParams.get('bvid') ?? '';
    if (url.pathname.endsWith('/online/total')) {
      return {
        status: 200,
        body: JSON.stringify({ code: 0, data: { total: '1234+' } }),
        headers: {},
        durationMs: 3,
      };
    }
    if (url.pathname.endsWith('/relation/stat')) {
      return {
        status: 200,
        body: JSON.stringify({ code: 0, data: { follower: 900, following: 15 } }),
        headers: {},
        durationMs: 3,
      };
    }
    return {
      status: 200,
      body: JSON.stringify(viewBody(bvid, mode(bvid))),
      durationMs: 3,
      headers: {},
    };
  };
}

describe('bilibili collector against postgres', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('a fixture transport writes one idempotent sample with comment_count', async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    const db = isolated.sql;
    const created = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: 'BV1xx411c7mD',
      label: '视频',
      tags: [],
      intervalMinutes: 60,
      now: new Date(),
    });
    const provider = createBilibiliProvider(
      {
        ...readBilibiliRuntimeConfig({}),
        minIntervalMs: 0,
        maxJitterMs: 0,
        anonymousMinIntervalMs: 0,
      },
      { transport: transportFor(() => 0), random: () => 0 },
    );
    const config = { ...readCollectorConfig({ COLLECTOR_INSTANCE_ID: 'bili-it' }), maxAttempts: 3 };
    expect(
      await runCollectorOnce({ sql: db, provider, config, env: { COLLECTOR_SECRET_KEY: '' } }),
    ).toBe('succeeded');

    const [row] = await db<
      {
        same: boolean;
        comment_count: string;
        online_viewers: string;
        online_viewers_raw: string;
        source: string;
        collected: Date | null;
        cid: string;
        view_count: string;
      }[]
    >`
      SELECT (s.sampled_at = j.scheduled_for) AS same,
        s.comment_count::text AS comment_count,
        s.online_viewers::text AS online_viewers,
        s.online_viewers_raw,
        s.source,
        s.collected_at AS collected,
        v.cid::text AS cid,
        s.view_count::text AS view_count
      FROM video_metric_samples s
      JOIN collector_jobs j ON j.target_id = ${created.target.id}::uuid
      JOIN videos v ON v.bvid = s.bvid
      WHERE s.bvid = 'BV1xx411c7mD'
    `;
    expect(row?.same).toBe(true);
    expect(row?.comment_count).toBe('7');
    expect(row?.online_viewers).toBe('1234');
    expect(row?.online_viewers_raw).toBe('1234+');
    expect(row?.source).toBe('bilibili');
    expect(row?.collected).toBeInstanceOf(Date);
    expect(row?.cid).toBe('555');
    expect(row?.view_count).toBe('1000');
    const [cadence] = await db<{ minutes: number; seconds: number }[]>`
      SELECT t.interval_minutes AS minutes,
        EXTRACT(EPOCH FROM (t.next_run_at - t.last_success_at))::int AS seconds
      FROM monitor_targets t
      WHERE t.id = ${created.target.id}::uuid
    `;
    expect(cadence?.minutes).toBe(15);
    expect(cadence?.seconds).toBe(15 * 60);

    await db`
      UPDATE collector_jobs
      SET status = 'pending', attempts = 0, started_at = NULL, finished_at = NULL, error = NULL
      WHERE target_id = ${created.target.id}::uuid
    `;
    expect(
      await runCollectorOnce({ sql: db, provider, config, env: { COLLECTOR_SECRET_KEY: '' } }),
    ).toBe('succeeded');
    const [count] = await db<{ count: string; view_count: string }[]>`
      SELECT count(*)::text AS count, max(view_count)::text AS view_count
      FROM video_metric_samples WHERE bvid = 'BV1xx411c7mD'
    `;
    expect(count?.count).toBe('1');
    expect(count?.view_count).toBe('1000');

    const offline: MonitorProvider = createMonitorProvider('offline');
    const offlineTarget = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: 'BV1xx411c7mE',
      label: '离线',
      tags: [],
      intervalMinutes: 60,
      now: new Date(),
    });
    await db`
      UPDATE collector_jobs
      SET scheduled_for = statement_timestamp() + interval '2 days'
      WHERE target_id <> ${offlineTarget.target.id}::uuid AND status = 'pending'
    `;
    expect(await runCollectorOnce({ sql: db, provider: offline, config })).toBe('succeeded');
    const [offlineRow] = await db<{ source: string }[]>`
      SELECT source FROM video_metric_samples WHERE bvid = 'BV1xx411c7mE'
    `;
    expect(offlineRow?.source).toBe('import');
  });

  test('already-succeeded -404 disables; -352 survives in collector_circuits', async () => {
    if (!sql) return;
    const db = sql;
    const missing = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: 'BV1xx411c7mF',
      label: '缺失',
      tags: [],
      intervalMinutes: 60,
      now: new Date(),
    });
    // Simulate a prior successful collect so -404 keeps the immediate-disable path.
    await db`
      UPDATE monitor_targets
      SET last_success_at = statement_timestamp() - interval '1 hour'
      WHERE id = ${missing.target.id}::uuid
    `;
    await db`
      UPDATE collector_jobs SET scheduled_for = statement_timestamp() + interval '3 days'
      WHERE status = 'pending' AND target_id <> ${missing.target.id}::uuid
    `;
    const provider = createBilibiliProvider(
      {
        ...readBilibiliRuntimeConfig({}),
        minIntervalMs: 0,
        maxJitterMs: 0,
        anonymousMinIntervalMs: 0,
      },
      {
        transport: transportFor((bvid) => (bvid === 'BV1xx411c7mF' ? -404 : -352)),
        random: () => 0,
      },
    );
    const config = {
      ...readCollectorConfig({ COLLECTOR_INSTANCE_ID: 'bili-err' }),
      maxAttempts: 3,
    };
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('failed');
    const [target] = await db<{ enabled: boolean; last_error: string | null }[]>`
      SELECT enabled, last_error FROM monitor_targets WHERE id = ${missing.target.id}::uuid
    `;
    expect(target?.enabled).toBe(false);
    expect(target?.last_error ?? '').toContain('-404');
    expect(target?.last_error ?? '').not.toContain('first_access');

    const key = randomBytes(32);
    const secret = encryptCookieJar({ session: 'fixture' }, key);
    const saved = await saveActiveBiliAccount(db, {
      id: crypto.randomUUID(),
      mid: '42',
      uname: 'UP',
      avatarUrl: null,
      cookieExpiresAt: null,
      secret,
    });
    const loaded = await readBiliAccountSecret(db, saved.accountId);
    expect(loaded?.ciphertext.equals(secret.ciphertext)).toBe(true);
    const risk = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: 'BV1xx411c7mG',
      label: '风控',
      tags: [],
      intervalMinutes: 60,
      now: new Date(),
    });
    await db`
      UPDATE monitor_targets SET account_id = ${saved.accountId}::uuid WHERE id = ${risk.target.id}::uuid
    `;
    await db`
      UPDATE collector_jobs SET scheduled_for = statement_timestamp() + interval '3 days'
      WHERE status = 'pending' AND target_id <> ${risk.target.id}::uuid
    `;
    expect(
      await runCollectorOnce({
        sql: db,
        provider,
        config,
        env: { COLLECTOR_SECRET_KEY: key.toString('base64') },
      }),
    ).toBe('failed');
    const [circuit] = await db<{ resume_at: Date; reason: string }[]>`
      SELECT resume_at, reason FROM collector_circuits WHERE account_id = ${saved.accountId}::uuid
    `;
    expect(circuit?.reason ?? '').toContain('-352');
    expect(circuit && circuit.resume_at.getTime()).toBeGreaterThan(Date.now() + 20 * 60 * 1000);

    const later = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'creator',
      externalId: '424242',
      label: '推迟',
      tags: [],
      intervalMinutes: 60,
      now: new Date(),
    });
    await db`
      UPDATE monitor_targets SET account_id = ${saved.accountId}::uuid WHERE id = ${later.target.id}::uuid
    `;
    await db`
      UPDATE collector_jobs SET scheduled_for = statement_timestamp() + interval '4 days'
      WHERE status = 'pending' AND target_id <> ${later.target.id}::uuid
    `;
    expect(
      await runCollectorOnce({
        sql: db,
        provider,
        config,
        env: { COLLECTOR_SECRET_KEY: key.toString('base64') },
      }),
    ).toBe('deferred');
    const [deferred] = await db<{ status: string; scheduled_for: Date }[]>`
      SELECT status, scheduled_for FROM collector_jobs WHERE target_id = ${later.target.id}::uuid
    `;
    expect(deferred?.status).toBe('pending');
    expect(deferred && deferred.scheduled_for.getTime()).toBeGreaterThan(
      Date.now() + 10 * 60 * 1000,
    );
  });
});

describe('legacy csv import', () => {
  test('imports BOM samples idempotently with null comments', async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    try {
      const dir = mkdtempSync(join(tmpdir(), 'legacy-csv-'));
      writeFileSync(
        join(dir, 'BV1xx411c7mH_views.csv'),
        `\uFEFF时间,播放量,在线观看人数,点赞,投币,收藏,分享,弹幕\r\n2026-04-25 22:01,88,6,13,10,2,0,0\r\n`,
      );
      writeFileSync(
        join(dir, '1030924321_follower.csv'),
        `\uFEFF时间,粉丝数\r\n2026-04-25 22:01,34221\r\n`,
      );
      const first = await importLegacyDirectory(isolated.sql, dir);
      const second = await importLegacyDirectory(isolated.sql, dir);
      expect(first.files.map((file) => file.inserted).sort()).toEqual([1, 1]);
      expect(second.files.every((file) => file.inserted === 0 && file.conflicts === 1)).toBe(true);
      expect(first.earliest).toBe('2026-04-25T14:01:00.000Z');
      const [video] = await isolated.sql<{ comment_count: string | null; source: string }[]>`
        SELECT comment_count::text AS comment_count, source
        FROM video_metric_samples WHERE bvid = 'BV1xx411c7mH'
      `;
      expect(video?.comment_count).toBeNull();
      expect(video?.source).toBe('legacy_csv');
      const [batch] = await isolated.sql<{ mode: string; file: string }[]>`
        SELECT mode, report_json->>'file' AS file FROM import_batches WHERE importer_version = 'legacy-csv'
        ORDER BY started_at
        LIMIT 1
      `;
      expect(batch?.mode).toBe('apply');
      expect(batch?.file).toContain('.csv');
    } finally {
      await isolated.sql.end({ timeout: 5 });
      await dropIsolatedTestDatabase(isolated.databaseName);
    }
  });
});
