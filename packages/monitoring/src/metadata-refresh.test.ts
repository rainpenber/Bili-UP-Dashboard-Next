import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase } from '@studio/db';
import { createLogger } from '@studio/observability';
import type { HttpTransport } from './bilibili-transport';
import type { BinaryTransport } from './image-asset';
import {
  readMetadataRun,
  reapStaleBackfillRuns,
  refreshCreator,
  refreshVideo,
  startMetadataBackfill,
  type MetadataRefreshDeps,
} from './metadata-refresh';
import { installOfflineFetchGuard } from './network-guard';
import { parseViewDetail } from './view-detail';

installOfflineFetchGuard();

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const SECRET = 'secret-token-9f3a';

function detailBody(bvid: string, patch: Record<string, unknown> = {}) {
  return {
    code: 0,
    message: '0',
    data: {
      View: {
        bvid,
        aid: 99,
        cid: 123456789,
        title: '接口标题',
        pubdate: 1_720_000_000,
        duration: 95,
        desc: '简介',
        tname: '',
        tname_v2: '',
        tid: 95,
        tid_v2: 2102,
        pic: 'http://i0.hdslb.com/bfs/archive/cover.jpg',
        owner: { mid: 42, name: 'UP', face: 'https://i1.hdslb.com/bfs/face/a.jpg' },
        ...patch,
      },
      Tags: [{ tag_name: '测评' }, { tag_name: '开箱' }, { tag_name: '测评' }],
      Card: {
        card: { name: '卡片名', face: 'https://i1.hdslb.com/bfs/face/a.jpg', sign: '签名' },
        follower: 20,
        archive_count: 3,
      },
    },
  };
}

function download(): BinaryTransport {
  return async (request) => ({
    status: 200,
    headers: { 'content-type': 'image/png' },
    body: PNG,
    finalUrl: request.url,
  });
}

describe('metadata refresh', () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const name of created) await dropIsolatedTestDatabase(name).catch(() => undefined);
  });

  test('empty tname stays empty and a missing cid stays null', () => {
    const parsed = parseViewDetail(detailBody('BV1xx411c7mD', { cid: undefined }));
    expect(parsed.tname).toBe('');
    expect(parsed.tnameV2).toBe('');
    expect(parsed.cid).toBeNull();
    expect(parsed.tags).toEqual(['测评', '开箱']);
  });

  test('writes view/detail fields once and does not duplicate tags', async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql = isolated.sql;
    try {
      const urls: string[] = [];
      const transport: HttpTransport = async (request) => {
        urls.push(request.url);
        expect(request.headers.Cookie).toBeUndefined();
        return {
          status: 200,
          headers: {},
          durationMs: 1,
          body: JSON.stringify(detailBody('BV1aptest111')),
        };
      };
      const deps: MetadataRefreshDeps = {
        sql,
        transport,
        download: download(),
        assetsRoot: mkdtempSync(join(tmpdir(), 'meta-assets-')),
        ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
        random: () => 0,
      };
      const first = await refreshVideo(deps, 'BV1aptest111', false);
      expect(first).toMatchObject({
        bvid: 'BV1aptest111',
        cid: '123456789',
        title: '接口标题',
        tags: ['测评', '开箱'],
        metadataState: 'ok',
        coverState: 'ok',
      });
      const row = await sql<
        {
          description: string | null;
          duration_seconds: number | null;
          tid: number | null;
          tid_v2: number | null;
          partition_name: string | null;
          tname: string | null;
          cover_url: string | null;
          metadata_source: string | null;
        }[]
      >`
        SELECT description, duration_seconds, tid, tid_v2, partition_name,
          metadata->>'tname' AS tname, cover_url, metadata_source
        FROM videos WHERE bvid = 'BV1aptest111'
      `;
      expect(row[0]).toMatchObject({
        description: '简介',
        duration_seconds: 95,
        tid: 95,
        tid_v2: 2102,
        partition_name: null,
        tname: '',
        cover_url: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
        metadata_source: 'bilibili',
      });
      const calls = urls.length;
      await refreshVideo(deps, 'BV1aptest111', true);
      const tags = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM video_tags WHERE bvid = 'BV1aptest111'
      `;
      expect(tags[0]?.n).toBe(2);
      expect(urls.length).toBe(calls + 1);

      const skippedUrls = urls.length;
      const skipped = await refreshVideo(deps, 'BV1aptest111', false);
      expect(skipped.metadataState).toBe('ok');
      expect(urls.length).toBe(skippedUrls);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test('-352 aborts the batch and -404 fails only that item', async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql = isolated.sql;
    try {
      const script = new Map<string, unknown>([
        ['BV1aptest211', detailBody('BV1aptest211')],
        [
          'BV1aptest212',
          { code: -352, message: `风控 SESSDATA=${SECRET}; bili_jct=jct-token-9f3a` },
        ],
        ['BV1aptest213', detailBody('BV1aptest213')],
        ['BV1aptest221', detailBody('BV1aptest221')],
        ['BV1aptest222', { code: -404, message: '啥都木有' }],
        ['BV1aptest223', detailBody('BV1aptest223')],
      ]);
      const seen: string[] = [];
      const transport: HttpTransport = async (request) => {
        const bvid = new URL(request.url).searchParams.get('bvid') ?? '';
        seen.push(bvid);
        return {
          status: 200,
          headers: {},
          durationMs: 1,
          body: JSON.stringify(script.get(bvid) ?? { code: -404, message: 'missing' }),
        };
      };
      const deps: MetadataRefreshDeps = {
        sql,
        transport,
        download: download(),
        assetsRoot: mkdtempSync(join(tmpdir(), 'meta-assets-')),
        ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
        random: () => 0,
      };
      const aborted = await startMetadataBackfill(deps, {
        kind: 'video',
        ids: ['BV1aptest211', 'BV1aptest212', 'BV1aptest213'],
      });
      await aborted.done;
      expect(seen).toEqual(['BV1aptest211', 'BV1aptest212']);
      const abortRun = await readMetadataRun(sql, aborted.backfillRunId);
      expect(abortRun?.status).toBe('aborted');
      expect(abortRun?.succeeded).toBe(1);
      expect(abortRun?.failed).toBe(1);
      expect(JSON.stringify(abortRun)).not.toContain('SESSDATA');
      expect(JSON.stringify(abortRun)).not.toContain(SECRET);
      const failed = await sql<{ metadata_state: string; metadata_error: string | null }[]>`
        SELECT metadata_state, metadata_error FROM videos WHERE bvid = 'BV1aptest212'
      `;
      expect(failed[0]?.metadata_state).toBe('failed');
      expect(failed[0]?.metadata_error ?? '').not.toContain(SECRET);
      expect(failed[0]?.metadata_error ?? '').not.toContain('bili_jct');

      seen.length = 0;
      const partial = await startMetadataBackfill(deps, {
        kind: 'video',
        ids: ['BV1aptest221', 'BV1aptest222', 'BV1aptest223'],
      });
      await partial.done;
      expect(seen).toEqual(['BV1aptest221', 'BV1aptest222', 'BV1aptest223']);
      const partialRun = await readMetadataRun(sql, partial.backfillRunId);
      expect(partialRun?.status).toBe('succeeded');
      expect(partialRun?.failed).toBe(1);
      expect(partialRun?.succeeded).toBe(2);
      const missing = await sql<{ metadata_state: string }[]>`
        SELECT metadata_state FROM videos WHERE bvid = 'BV1aptest222'
      `;
      expect(missing[0]?.metadata_state).toBe('failed');
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test('creator refresh stores a follower sample and stays partial without a card', async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql = isolated.sql;
    try {
      const transport: HttpTransport = async (request) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith('/relation/stat')) {
          return {
            status: 200,
            headers: {},
            durationMs: 1,
            body: JSON.stringify({ code: 0, data: { mid: 42, following: 1, follower: 20 } }),
          };
        }
        return {
          status: 200,
          headers: {},
          durationMs: 1,
          body: JSON.stringify(detailBody('BV1aptest311')),
        };
      };
      const deps: MetadataRefreshDeps = {
        sql,
        transport,
        download: download(),
        assetsRoot: mkdtempSync(join(tmpdir(), 'meta-assets-')),
        ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
        now: () => new Date('2026-10-19T03:04:00.000Z'),
        random: () => 0,
      };
      const partial = await refreshCreator(deps, '42', true);
      expect(partial.metadataState).toBe('partial');
      expect(partial.followerCount).toBe('20');
      await sql`
        INSERT INTO videos (bvid, mid) VALUES ('BV1aptest311', 42)
      `;
      const full = await refreshCreator(deps, '42', true);
      expect(full).toMatchObject({ uname: '卡片名', metadataState: 'ok' });
      expect(full.faceAssetId).toBeTruthy();
      const samples = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM creator_follower_samples WHERE mid = 42
      `;
      expect(samples[0]?.n).toBe(1);
      const audited = await sql<
        { endpoint: string; biz_code: number | null; run_id: string | null }[]
      >`
        SELECT endpoint, biz_code, run_id::text AS run_id
        FROM collector_requests ORDER BY id
      `;
      expect(audited.map((row) => row.endpoint)).toEqual([
        'relation/stat',
        'relation/stat',
        'card',
        'image',
      ]);
      expect(audited[0]?.biz_code).toBe(0);
      expect(audited[2]?.biz_code).toBe(0);
      expect(audited[3]?.biz_code).toBeNull();
      expect(audited.every((row) => row.run_id === null)).toBe(true);

      const staleId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';
      const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
      await sql`
        INSERT INTO backfill_runs (id, kind, mode, status, requested, report, started_at)
        VALUES (
          ${staleId}::uuid,
          'video',
          'bvid',
          'running',
          1,
          ${JSON.stringify({ heartbeatAt: old, items: [] })}::jsonb,
          ${old}::timestamptz
        )
      `;
      expect(await reapStaleBackfillRuns(sql, new Date())).toBe(1);
      const reaped = await readMetadataRun(sql, staleId);
      expect(reaped?.status).toBe('aborted');
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test('batch refresh writes one collector_requests row per call and backfill logs', async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql = isolated.sql;
    try {
      const calls: string[] = [];
      const transport: HttpTransport = async (request) => {
        calls.push(request.url);
        const bvid = new URL(request.url).searchParams.get('bvid') ?? '';
        const body =
          bvid === 'BV1aptest512'
            ? { code: -404, message: `稿件不可见 SESSDATA=${SECRET}; bili_jct=jct-token-9f3a` }
            : detailBody(bvid);
        return { status: 200, headers: {}, durationMs: 4, body: JSON.stringify(body) };
      };
      let images = 0;
      const logger = createLogger({ service: 'api', sql, instance: 'refresh-audit' });
      const deps: MetadataRefreshDeps = {
        sql,
        transport,
        download: async (request) => {
          images += 1;
          return download()(request);
        },
        assetsRoot: mkdtempSync(join(tmpdir(), 'meta-assets-')),
        ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
        random: () => 0,
        logger,
      };
      const started = await startMetadataBackfill(deps, {
        kind: 'video',
        ids: ['BV1aptest511', 'BV1aptest512'],
      });
      await started.done;
      const requests = await sql<
        {
          endpoint: string;
          biz_code: number | null;
          status_code: number | null;
          error: string | null;
          run_id: string | null;
        }[]
      >`
        SELECT endpoint, biz_code, status_code, error, run_id::text AS run_id
        FROM collector_requests ORDER BY id
      `;
      expect(requests).toHaveLength(calls.length + images);
      expect(requests.map((row) => row.endpoint)).toEqual(['view/detail', 'image', 'view/detail']);
      expect(requests[0]).toMatchObject({
        biz_code: 0,
        status_code: 200,
        run_id: started.backfillRunId,
      });
      expect(requests[1]).toMatchObject({ endpoint: 'image', biz_code: null, status_code: 200 });
      expect(requests[2]).toMatchObject({ biz_code: -404, run_id: started.backfillRunId });
      expect(JSON.stringify(requests)).not.toMatch(/SESSDATA|bili_jct/);
      expect(requests[2]?.error ?? '').not.toContain(SECRET);

      const logs = await sql<
        { event: string; level: string; context: { bvid?: string; code?: number } }[]
      >`
        SELECT event, level, context FROM app_logs ORDER BY id
      `;
      expect(logs.map((row) => row.event)).toEqual([
        'backfill.started',
        'backfill.item_failed',
        'backfill.finished',
      ]);
      const failed = logs.find((row) => row.event === 'backfill.item_failed');
      expect(failed?.level).toBe('warn');
      expect(failed?.context.bvid).toBe('BV1aptest512');
      expect(failed?.context.code).toBe(-404);
      expect(JSON.stringify(logs)).not.toMatch(/SESSDATA|bili_jct/);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
