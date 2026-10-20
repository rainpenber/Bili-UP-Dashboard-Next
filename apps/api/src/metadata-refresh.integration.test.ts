import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMetadataRunResponse, parseVideoRefreshResponse } from '@studio/contracts';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase, type Sql } from '@studio/db';
import type { HttpTransport } from '@studio/monitoring';
import { createLogger } from '@studio/observability';
import { Hono } from 'hono';
import { createMonitorRoutes } from './monitor-routes';
import { createOpsRoutes } from './ops-routes';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function detail(bvid: string) {
  return {
    code: 0,
    message: '0',
    data: {
      View: {
        bvid,
        cid: 55,
        title: '已拉取',
        pubdate: 1_720_000_000,
        duration: 10,
        desc: 'd',
        tname: '',
        tname_v2: '',
        tid: 95,
        tid_v2: 2102,
        pic: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
        owner: { mid: 7, name: 'UP' },
      },
      Tags: [{ tag_name: '标签' }],
    },
  };
}

describe('metadata refresh API', () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const name of created) await dropIsolatedTestDatabase(name).catch(() => undefined);
  });

  test('returns 202 for one running batch and skips an already-ok video', async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql: Sql = isolated.sql;
    try {
      let releaseGate: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      const urls: string[] = [];
      const transport: HttpTransport = async (request) => {
        urls.push(request.url);
        const bvid = new URL(request.url).searchParams.get('bvid') ?? 'BV1aptest411';
        return { status: 200, headers: {}, durationMs: 1, body: JSON.stringify(detail(bvid)) };
      };
      let pending: Promise<void> | null = null;
      const app = new Hono();
      app.route(
        '/api/v1/monitor',
        createMonitorRoutes(sql, {
          transport,
          download: async (request) => ({
            status: 200,
            headers: { 'content-type': 'image/png' },
            body: PNG,
            finalUrl: request.url,
          }),
          assetsRoot: mkdtempSync(join(tmpdir(), 'api-assets-')),
          ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
          gate: () => gate,
          onBackfill: (task) => {
            pending = task;
          },
        }),
      );
      app.route('/api/v1/ops', createOpsRoutes(sql));

      const started = await app.request('/api/v1/monitor/metadata/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'video', ids: ['BV1aptest411'] }),
      });
      expect(started.status).toBe(202);
      const accepted = (await started.json()) as { backfillRunId: string; requested: number };
      expect(accepted.requested).toBe(1);
      const running = await app.request(`/api/v1/monitor/metadata/runs/${accepted.backfillRunId}`);
      expect(running.status).toBe(200);
      expect(parseMetadataRunResponse(await running.json()).status).toBe('running');
      const again = await app.request('/api/v1/monitor/metadata/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'video', ids: ['BV1aptest412'] }),
      });
      expect(again.status).toBe(409);
      const active = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM backfill_runs WHERE status = 'running'
      `;
      expect(active[0]?.n).toBe(1);
      releaseGate();
      await pending;
      const done = await app.request(`/api/v1/ops/metadata/runs/${accepted.backfillRunId}`);
      expect(parseMetadataRunResponse(await done.json()).status).toBe('succeeded');

      const calls = urls.length;
      await sql`
        INSERT INTO videos (bvid, title, cid, metadata_state, metadata_source, cover_state)
        VALUES ('BV1aptest413', '现成标题', 9, 'ok', 'bilibili', 'none')
      `;
      await sql`
        INSERT INTO video_tags (bvid, tag, ordinal, source)
        VALUES ('BV1aptest413', '已有', 0, 'bilibili')
      `;
      const cached = await app.request('/api/v1/monitor/videos/BV1aptest413/refresh', {
        method: 'POST',
        body: JSON.stringify({ force: false }),
      });
      expect(cached.status).toBe(200);
      expect(parseVideoRefreshResponse(await cached.json())).toMatchObject({
        bvid: 'BV1aptest413',
        cid: '9',
        title: '现成标题',
        tags: ['已有'],
        metadataState: 'ok',
      });
      expect(urls.length).toBe(calls);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test('API refresh persists request audit and backfill logs', async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql: Sql = isolated.sql;
    try {
      let pending: Promise<void> | null = null;
      const logger = createLogger({ service: 'api', sql, instance: 'api-refresh' });
      const transport: HttpTransport = async (request) => {
        const bvid = new URL(request.url).searchParams.get('bvid') ?? '';
        const body =
          bvid === 'BV1aptest612'
            ? { code: 62012, message: '稿件不可见 SESSDATA=api-secret; bili_jct=api-jct' }
            : detail(bvid);
        return { status: 200, headers: {}, durationMs: 3, body: JSON.stringify(body) };
      };
      const app = new Hono();
      app.route(
        '/api/v1/monitor',
        createMonitorRoutes(sql, {
          logger,
          transport,
          download: async (request) => ({
            status: 200,
            headers: { 'content-type': 'image/png' },
            body: PNG,
            finalUrl: request.url,
          }),
          assetsRoot: mkdtempSync(join(tmpdir(), 'api-audit-')),
          ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
          onBackfill: (task) => {
            pending = task;
          },
        }),
      );
      app.route('/api/v1/ops', createOpsRoutes(sql));
      const started = await app.request('/api/v1/monitor/metadata/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'video', ids: ['BV1aptest611', 'BV1aptest612'] }),
      });
      expect(started.status).toBe(202);
      await pending;
      const listed = (await (await app.request('/api/v1/ops/requests')).json()) as {
        items: { endpoint: string; bizCode: number | null }[];
      };
      expect(listed.items.map((item) => item.endpoint).sort()).toEqual([
        'image',
        'view/detail',
        'view/detail',
      ]);
      expect(listed.items.some((item) => item.bizCode === 62012)).toBe(true);
      const logs = await sql<{ event: string }[]>`
        SELECT event FROM app_logs WHERE event LIKE 'backfill.%' ORDER BY id
      `;
      expect(logs.map((row) => row.event)).toEqual([
        'backfill.started',
        'backfill.item_failed',
        'backfill.finished',
      ]);
      const stored = JSON.stringify({ listed, logs });
      const audit = await sql<{ error: string | null; context: unknown }[]>`
        SELECT error, NULL::jsonb AS context FROM collector_requests
        UNION ALL
        SELECT message, context FROM app_logs
      `;
      expect(JSON.stringify(audit) + stored).not.toMatch(/SESSDATA|bili_jct|api-secret|api-jct/);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
