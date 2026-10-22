/**
 * WP-R2-MON-03: first successful video collect auto-enqueues metadata refresh.
 * Fail-closed: REQUIRE_POSTGRES / createRetainedTestDatabase. Retains wp_r2_mon03_*.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRetainedTestDatabase, insertMonitorTarget, type Sql } from '@studio/db';
import {
  createBilibiliProvider,
  drainDeferredAutoVideoMetadataRefresh,
  enqueueAutoVideoMetadataRefresh,
  installOfflineFetchGuard,
  readBilibiliRuntimeConfig,
  readCollectorConfig,
  runCollectorOnce,
  startMetadataBackfill,
  type BinaryTransport,
  type HttpTransport,
  type TransportRequest,
} from '@studio/monitoring';
import { createApp } from './app';
import { mountApiRoutes } from './mount-api';

installOfflineFetchGuard();

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const pubdate = Math.floor(Date.now() / 1000) - 3600;

function viewBody(bvid: string, code = 0) {
  return {
    code,
    message: code === 0 ? '0' : 'no',
    data:
      code === 0
        ? {
            bvid,
            cid: 777,
            pubdate,
            title: '自动补封面',
            pic: 'https://i0.hdslb.com/bfs/archive/auto-cover.jpg',
            owner: { mid: 99, name: 'UP' },
            stat: {
              view: 100,
              danmaku: 1,
              reply: 2,
              favorite: 3,
              coin: 4,
              share: 5,
              like: 6,
            },
          }
        : null,
  };
}

function detailBody(bvid: string) {
  return {
    code: 0,
    message: '0',
    data: {
      View: {
        bvid,
        aid: 1,
        cid: 777,
        title: '自动补封面-详情',
        pubdate,
        duration: 42,
        desc: '简介',
        tname: '',
        tname_v2: '',
        tid: 95,
        tid_v2: 2102,
        pic: 'https://i0.hdslb.com/bfs/archive/auto-cover.jpg',
        owner: { mid: 99, name: 'UP' },
      },
      Tags: [{ tag_name: '自动' }],
    },
  };
}

function metricTransport(): HttpTransport {
  return async (request: TransportRequest) => {
    const url = new URL(request.url);
    const bvid = url.searchParams.get('bvid') ?? '';
    if (url.pathname.endsWith('/online/total')) {
      return {
        status: 200,
        body: JSON.stringify({ code: 0, data: { total: '9' } }),
        headers: {},
        durationMs: 1,
      };
    }
    if (url.pathname.endsWith('/relation/stat')) {
      return {
        status: 200,
        body: JSON.stringify({ code: 0, data: { follower: 1, following: 0 } }),
        headers: {},
        durationMs: 1,
      };
    }
    return {
      status: 200,
      body: JSON.stringify(viewBody(bvid)),
      headers: {},
      durationMs: 1,
    };
  };
}

function combinedTransport(imageHits: { count: number }, imageMode: 'ok' | '404' | 'gif' = 'ok'): {
  transport: HttpTransport;
  download: BinaryTransport;
  detailHits: { count: number };
} {
  const detailHits = { count: 0 };
  const transport: HttpTransport = async (request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/view/detail')) {
      detailHits.count += 1;
      const bvid = url.searchParams.get('bvid') ?? 'BV1aptest001';
      return {
        status: 200,
        headers: {},
        durationMs: 1,
        body: JSON.stringify(detailBody(bvid)),
      };
    }
    return metricTransport()(request);
  };
  const download: BinaryTransport = async (request) => {
    imageHits.count += 1;
    if (imageMode === '404') {
      return { status: 404, headers: {}, body: new Uint8Array(), finalUrl: request.url };
    }
    if (imageMode === 'gif') {
      return {
        status: 200,
        headers: { 'content-type': 'image/gif' },
        body: Buffer.from('GIF89a'),
        finalUrl: request.url,
      };
    }
    return {
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: PNG,
      finalUrl: request.url,
    };
  };
  return { transport, download, detailHits };
}

async function parkOtherPending(sql: Sql, keepTargetId: string): Promise<void> {
  await sql`
    UPDATE collector_jobs
    SET scheduled_for = statement_timestamp() + interval '30 days'
    WHERE status = 'pending' AND target_id <> ${keepTargetId}::uuid
  `;
  await sql`
    UPDATE monitor_targets
    SET next_run_at = statement_timestamp() + interval '30 days'
    WHERE id <> ${keepTargetId}::uuid AND deleted_at IS NULL AND next_run_at IS NOT NULL
  `;
}

describe('WP-R2-MON-03 auto video metadata after first collect', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let assetsRoot = '';

  beforeAll(async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_mon03');
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    assetsRoot = mkdtempSync(join(tmpdir(), 'wp-r2-mon03-assets-'));
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    if (databaseName) console.log(`retained auto-metadata database: ${databaseName}`);
  });

  test('first video collect auto-refreshes cover once; card and detail expose imageAssetId', async () => {
    if (!sql) return;
    const db = sql;
    const bvid = 'BV1xx411c7mA';
    const imageHits = { count: 0 };
    const { transport, download, detailHits } = combinedTransport(imageHits);
    const pending: Promise<void>[] = [];
    const autoMetadata = {
      sql: db,
      transport,
      download,
      assetsRoot,
      ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
      random: () => 0,
      onBackfill: (task: Promise<void>) => {
        pending.push(task);
      },
    };

    const created = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: bvid,
      label: '新视频',
      tags: [],
      intervalMinutes: 15,
      now: new Date(),
    });
    await parkOtherPending(db, created.target.id);

    const app = createApp({ skipDb: true });
    mountApiRoutes(app, db, { transport, download, assetsRoot });

    const before = await app.request(`/api/v1/monitor/videos/${bvid}?source=collector`);
    expect(before.status).toBe(404);

    const provider = createBilibiliProvider(
      {
        ...readBilibiliRuntimeConfig({}),
        minIntervalMs: 0,
        maxJitterMs: 0,
        anonymousMinIntervalMs: 0,
      },
      { transport, random: () => 0 },
    );
    const config = {
      ...readCollectorConfig({ COLLECTOR_INSTANCE_ID: 'mon03-ok' }),
      maxAttempts: 3,
    };

    expect(await runCollectorOnce({ sql: db, provider, config, autoMetadata })).toBe('succeeded');
    expect(pending.length).toBe(1);
    await pending[0];

    const [video] = await db<
      {
        cover_asset_id: string | null;
        cover_state: string;
        metadata_state: string;
        sample_count: string;
        enabled: boolean;
      }[]
    >`
      SELECT v.cover_asset_id, v.cover_state, v.metadata_state,
        (SELECT count(*)::text FROM video_metric_samples s WHERE s.bvid = v.bvid) AS sample_count,
        t.enabled
      FROM videos v
      JOIN monitor_targets t ON t.external_id = v.bvid AND t.type = 'video'
      WHERE v.bvid = ${bvid}
    `;
    expect(video?.cover_asset_id).toBeTruthy();
    expect(video?.cover_state).toBe('ok');
    expect(video?.metadata_state).toBe('ok');
    expect(video?.sample_count).toBe('1');
    expect(video?.enabled).toBe(true);
    expect(detailHits.count).toBe(1);
    expect(imageHits.count).toBe(1);

    const runs = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM backfill_runs
      WHERE kind = 'video'
        AND report->>'auto' = 'true'
        AND report->'requestedIds' ? ${bvid}
    `;
    expect(runs[0]?.n).toBe(1);

    const detail = await app.request(`/api/v1/monitor/videos/${bvid}?source=collector`);
    expect(detail.status).toBe(200);
    const detailBodyJson = (await detail.json()) as { coverAssetId: string | null };
    expect(detailBodyJson.coverAssetId).toBeTruthy();

    const card = await app.request(`/api/v1/monitor/cards/video/${bvid}`);
    expect(card.status).toBe(200);
    const cardBody = (await card.json()) as { imageAssetId: string | null };
    expect(cardBody.imageAssetId).toBeTruthy();
    expect(cardBody.imageAssetId).toBe(detailBodyJson.coverAssetId);

    // Second collect (not first success) must not enqueue another refresh / download.
    await db`
      UPDATE monitor_targets
      SET next_run_at = statement_timestamp(), updated_at = statement_timestamp()
      WHERE id = ${created.target.id}::uuid
    `;
    await db`
      INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for)
      VALUES (
        ${crypto.randomUUID()}::uuid,
        ${created.target.id}::uuid,
        'pending',
        0,
        statement_timestamp()
      )
    `;
    const pendingBefore = pending.length;
    expect(await runCollectorOnce({ sql: db, provider, config, autoMetadata })).toBe('succeeded');
    expect(pending.length).toBe(pendingBefore);
    expect(imageHits.count).toBe(1);

    // Explicit re-enqueue with existing cover is skipped (no second download).
    const again = await enqueueAutoVideoMetadataRefresh(autoMetadata, bvid);
    expect(again.status).toBe('skipped');
    expect(again.status === 'skipped' && again.reason).toBe('has_cover');
    expect(imageHits.count).toBe(1);
  });

  test('same bvid concurrent enqueue yields one active refresh; image downloaded once', async () => {
    if (!sql) return;
    const db = sql;
    const bvid = 'BV1xx411c7mB';
    await db`INSERT INTO videos (bvid, title) VALUES (${bvid}, '并发')`;
    const imageHits = { count: 0 };
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const { transport, download } = combinedTransport(imageHits);
    const autoMetadata = {
      sql: db,
      transport,
      download,
      assetsRoot,
      ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
      random: () => 0,
      gate: () => gate,
    };

    const first = enqueueAutoVideoMetadataRefresh(autoMetadata, bvid);
    const second = enqueueAutoVideoMetadataRefresh(autoMetadata, bvid);
    const [a, b] = await Promise.all([first, second]);
    const started = [a, b].filter((r) => r.status === 'started');
    const skippedActive = [a, b].filter((r) => r.status === 'skipped' && r.reason === 'active');
    const deferred = [a, b].filter((r) => r.status === 'deferred');
    expect(started.length).toBe(1);
    expect(skippedActive.length + deferred.length).toBe(1);

    const running = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM backfill_runs
      WHERE status = 'running' AND report->'requestedIds' ? ${bvid}
    `;
    expect(running[0]?.n).toBe(1);
    releaseGate();
    const done = started[0];
    if (done && done.status === 'started') await done.done;
    expect(imageHits.count).toBe(1);
  });

  test('refresh image failure keeps samples and enabled target; error readable; no half asset', async () => {
    if (!sql) return;
    const db = sql;
    const bvid = 'BV1xx411c7mC';
    const imageHits = { count: 0 };
    const { transport, download } = combinedTransport(imageHits, '404');
    const pending: Promise<void>[] = [];
    const autoMetadata = {
      sql: db,
      transport,
      download,
      assetsRoot,
      ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
      random: () => 0,
      onBackfill: (task: Promise<void>) => {
        pending.push(task);
      },
    };

    const created = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: bvid,
      label: '失败封面',
      tags: [],
      intervalMinutes: 15,
      now: new Date(),
    });
    await parkOtherPending(db, created.target.id);

    const app = createApp({ skipDb: true });
    mountApiRoutes(app, db, { transport, download, assetsRoot });

    const provider = createBilibiliProvider(
      {
        ...readBilibiliRuntimeConfig({}),
        minIntervalMs: 0,
        maxJitterMs: 0,
        anonymousMinIntervalMs: 0,
      },
      { transport, random: () => 0 },
    );
    const config = {
      ...readCollectorConfig({ COLLECTOR_INSTANCE_ID: 'mon03-fail' }),
      maxAttempts: 3,
    };

    expect(await runCollectorOnce({ sql: db, provider, config, autoMetadata })).toBe('succeeded');
    expect(pending.length).toBe(1);
    await pending[0];

    const [row] = await db<
      {
        cover_asset_id: string | null;
        cover_state: string;
        metadata_state: string;
        metadata_error: string | null;
        sample_count: string;
        enabled: boolean;
      }[]
    >`
      SELECT v.cover_asset_id, v.cover_state, v.metadata_state, v.metadata_error,
        (SELECT count(*)::text FROM video_metric_samples s WHERE s.bvid = v.bvid) AS sample_count,
        t.enabled
      FROM videos v
      JOIN monitor_targets t ON t.external_id = v.bvid AND t.type = 'video'
      WHERE v.bvid = ${bvid}
    `;
    expect(row?.sample_count).toBe('1');
    expect(row?.enabled).toBe(true);
    expect(row?.cover_asset_id).toBeNull();
    expect(row?.cover_state).toBe('failed');
    // No half-written asset linked to this video.
    const linked = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM static_assets a
      JOIN videos v ON v.cover_asset_id = a.asset_id
      WHERE v.bvid = ${bvid}
    `;
    expect(linked[0]?.n).toBe(0);

    const pre = await app.request(`/api/v1/monitor/videos/${bvid}?source=collector`);
    expect(pre.status).toBe(200);
    expect(((await pre.json()) as { coverAssetId: string | null }).coverAssetId).toBeNull();

    // Cover still null → auto enqueue can be triggered again (force refresh).
    const retry = await enqueueAutoVideoMetadataRefresh(
      {
        ...autoMetadata,
        download: async (request) => ({
          status: 200,
          headers: { 'content-type': 'image/png' },
          body: PNG,
          finalUrl: request.url,
        }),
      },
      bvid,
    );
    expect(retry.status).toBe('started');
    if (retry.status === 'started') await retry.done;
    const [fixed] = await db<{ cover_asset_id: string | null; cover_state: string }[]>`
      SELECT cover_asset_id, cover_state FROM videos WHERE bvid = ${bvid}
    `;
    expect(fixed?.cover_asset_id).toBeTruthy();
    expect(fixed?.cover_state).toBe('ok');
  });

  test('creator and dynamic first collect do not enqueue video metadata refresh', async () => {
    if (!sql) return;
    const db = sql;
    // Isolate from prior cases that may have left a deferred queue marker.
    await db`
      UPDATE videos
      SET metadata = COALESCE(metadata, '{}'::jsonb) - 'auto_metadata_refresh'
      WHERE metadata ? 'auto_metadata_refresh'
    `;
    const imageHits = { count: 0 };
    const { transport, download } = combinedTransport(imageHits);
    const pending: Promise<void>[] = [];
    const autoMetadata = {
      sql: db,
      transport,
      download,
      assetsRoot,
      ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
      random: () => 0,
      onBackfill: (task: Promise<void>) => {
        pending.push(task);
      },
    };
    const provider = createBilibiliProvider(
      {
        ...readBilibiliRuntimeConfig({}),
        minIntervalMs: 0,
        maxJitterMs: 0,
        anonymousMinIntervalMs: 0,
      },
      { transport, random: () => 0 },
    );
    const config = {
      ...readCollectorConfig({ COLLECTOR_INSTANCE_ID: 'mon03-nonvideo' }),
      maxAttempts: 3,
    };

    const creator = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'creator',
      externalId: '90001',
      label: 'UP',
      tags: [],
      intervalMinutes: 240,
      now: new Date(),
    });
    await parkOtherPending(db, creator.target.id);
    expect(await runCollectorOnce({ sql: db, provider, config, autoMetadata })).toBe('succeeded');
    expect(pending.length).toBe(0);

    const beforeRuns = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM backfill_runs WHERE report->>'auto' = 'true'
    `;
    const autoBefore = beforeRuns[0]?.n ?? 0;

    // Historical / CSV-style video rows (cover pending) must not be bulk auto-queued.
    await db`
      INSERT INTO videos (bvid, title, metadata_state, cover_state)
      VALUES ('BV1xx411c7mD', '历史', 'pending', 'pending')
    `;
    const drained = await drainDeferredAutoVideoMetadataRefresh(autoMetadata, 10);
    expect(drained).toBe(0);
    // Historical pending video must not get a queue marker from drain alone.
    const historicalQueued = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM videos
      WHERE bvid = 'BV1xx411c7mD' AND metadata->>'auto_metadata_refresh' = 'queued'
    `;
    expect(historicalQueued[0]?.n).toBe(0);
    const afterRuns = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM backfill_runs WHERE report->>'auto' = 'true'
    `;
    expect(afterRuns[0]?.n).toBe(autoBefore);
    expect(imageHits.count).toBe(0);
    expect(pending.length).toBe(0);
  });

  test('busy backfill defers then drain starts exactly one refresh', async () => {
    if (!sql) return;
    const db = sql;
    const busy = 'BV1xx411c7mE';
    const waiting = 'BV1xx411c7mF';
    await db`INSERT INTO videos (bvid) VALUES (${busy}), (${waiting})`;
    const imageHits = { count: 0 };
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const { transport, download } = combinedTransport(imageHits);
    const deps = {
      sql: db,
      transport,
      download,
      assetsRoot,
      ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
      random: () => 0,
      gate: () => gate,
    };

    const blocker = await startMetadataBackfill(deps, { kind: 'video', ids: [busy] });
    const deferred = await enqueueAutoVideoMetadataRefresh(deps, waiting);
    expect(deferred.status).toBe('deferred');
    const marked = await db<{ flag: string | null }[]>`
      SELECT metadata->>'auto_metadata_refresh' AS flag FROM videos WHERE bvid = ${waiting}
    `;
    expect(marked[0]?.flag).toBe('queued');

    releaseGate();
    await blocker.done;

    const drainedPending: Promise<void>[] = [];
    const started = await drainDeferredAutoVideoMetadataRefresh(
      {
        ...deps,
        gate: undefined,
        onBackfill: (task) => {
          drainedPending.push(task);
        },
      },
      1,
    );
    expect(started).toBe(1);
    expect(drainedPending.length).toBe(1);
    await drainedPending[0];
    const [after] = await db<{ cover_asset_id: string | null; flag: string | null }[]>`
      SELECT cover_asset_id, metadata->>'auto_metadata_refresh' AS flag
      FROM videos WHERE bvid = ${waiting}
    `;
    expect(after?.cover_asset_id).toBeTruthy();
    expect(after?.flag).toBeNull();
  });
});
