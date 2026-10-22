import { afterAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import {
  parseOpsDebugBundle,
  parseOpsHealth,
  parseOpsPage,
  parseOpsLog,
  parseOpsRequest,
  parseOpsRun,
  parseOpsRunDetail,
  parseOpsSummary,
} from '@studio/contracts';
import {
  createEmptyIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  runMigrations,
} from '@studio/db';
import { createOpsRoutes } from './ops-routes';

const SECRET = /SESSDATA|bili_jct|password|ciphertext/i;

describe('ops API', () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const name of created) {
      await dropIsolatedTestDatabase(name).catch(() => undefined);
    }
  });

  test('returns stable shapes for an empty database and a populated one', async () => {
    const isolated = await createEmptyIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql = isolated.sql;
    try {
      await runMigrations(sql);
      const app = new Hono();
      app.route('/api/v1/ops', createOpsRoutes(sql));

      const summary = parseOpsSummary(await (await app.request('/api/v1/ops/summary')).json());
      expect(summary.heartbeats).toEqual([]);
      expect(summary.queue).toEqual({ due: 0, running: 0, failed24h: 0 });
      expect(summary.circuits).toEqual([]);
      expect(summary.targets).toEqual([]);
      expect(summary.samplesToday).toEqual({ videos: 0, creators: 0 });
      expect(summary.recentErrorCount).toBe(0);

      const runs = parseOpsPage(
        await (await app.request('/api/v1/ops/runs')).json(),
        parseOpsRun,
        'runs',
      );
      expect(runs).toEqual({ items: [], nextCursor: null, limit: 50 });
      const requests = parseOpsPage(
        await (await app.request('/api/v1/ops/requests')).json(),
        parseOpsRequest,
        'requests',
      );
      expect(requests.items).toEqual([]);
      const logs = parseOpsPage(
        await (await app.request('/api/v1/ops/logs')).json(),
        parseOpsLog,
        'logs',
      );
      expect(logs.items).toEqual([]);
      const health = parseOpsHealth(await (await app.request('/api/v1/ops/health')).json());
      expect(health).toEqual({
        lastHeartbeatAt: null,
        stale: true,
        queueBacklog: 0,
        lastSuccessAt: null,
      });
      const missingBundle = await app.request('/api/v1/ops/debug/bundle');
      expect(missingBundle.status).toBe(400);
      const unknownRun = '44444444-4444-4444-8444-444444444444';
      const emptyBundle = parseOpsDebugBundle(
        await (await app.request(`/api/v1/ops/debug/bundle?runId=${unknownRun}`)).json(),
      );
      expect(emptyBundle.run).toBeNull();
      expect(emptyBundle.requests).toEqual([]);
      expect(emptyBundle.logs).toEqual([]);
      expect(JSON.stringify(emptyBundle)).not.toMatch(SECRET);

      const targetId = '22222222-2222-4222-8222-222222222222';
      const jobId = '33333333-3333-4333-8333-333333333333';
      const runId = '11111111-1111-4111-8111-111111111111';
      const accountId = '55555555-5555-4555-8555-555555555555';
      await sql`
        INSERT INTO videos (bvid, title, metadata_error, cover_url)
        VALUES (
          'BV1xx411c7mD',
          '标题',
          'SESSDATA=plain-sess-value-9f3a; bili_jct=plain-jct-value-9f3a',
          'https://example.test/cover?SESSDATA=plain-sess-value-9f3a'
        )
      `;
      await sql`
        INSERT INTO monitor_targets (id, type, external_id, label, interval_minutes, source, last_error)
        VALUES (
          ${targetId}::uuid, 'video', 'BV1xx411c7mD', '离线视频', 60, 'offline',
          'password leaked in last_error'
        )
      `;
      await sql`
        INSERT INTO collector_jobs (id, target_id, status, scheduled_for, finished_at)
        VALUES (${jobId}::uuid, ${targetId}::uuid, 'failed', '2026-10-19T00:00:00Z', now())
      `;
      await sql`
        INSERT INTO collector_runs (
          id, job_id, target_id, status, samples_written, duration_ms, error, started_at, finished_at
        ) VALUES (
          ${runId}::uuid, ${jobId}::uuid, ${targetId}::uuid, 'failed', 0, 40,
          'SESSDATA=plain-sess-value-9f3a', now(), now()
        )
      `;
      await sql`
        INSERT INTO collector_requests (run_id, endpoint, status_code, biz_code, duration_ms, error)
        VALUES (
          ${runId}::uuid, 'view', 200, -352, 15, 'bili_jct=plain-jct-value-9f3a'
        )
      `;
      await sql`
        INSERT INTO app_logs (level, service, event, message, run_id, context)
        VALUES (
          'error', 'collector', 'job.failed', 'ciphertext=abc password=secret',
          ${runId}::uuid, '{"password":"pw-secret","ciphertext":"ct-secret","note":"ok"}'::jsonb
        )
      `;
      await sql`
        INSERT INTO bili_accounts (id, status) VALUES (${accountId}::uuid, 'active')
      `;
      await sql`
        INSERT INTO collector_circuits (account_id, resume_at, reason)
        VALUES (${accountId}::uuid, now() + interval '30 minutes', 'password in reason')
      `;
      await sql`
        INSERT INTO collector_heartbeats (instance_id, last_seen_at, status)
        VALUES ('collector-1', now(), 'idle')
      `;
      await sql`
        INSERT INTO video_metric_samples (
          bvid, sampled_at, source_timezone, raw_time, timestamp_precision, view_count, collected_at
        ) VALUES (
          'BV1xx411c7mD', now(), 'Asia/Shanghai', '2026-10-19 08:00', 'minute', 3, now()
        )
      `;

      const populated = parseOpsSummary(await (await app.request('/api/v1/ops/summary')).json());
      expect(populated.heartbeats[0]?.instance).toBe('collector-1');
      expect(populated.queue.failed24h).toBe(1);
      expect(populated.circuits).toHaveLength(1);
      expect(populated.targets[0]?.label).toBe('离线视频');
      expect(populated.samplesToday.videos).toBe(1);
      expect(JSON.stringify(populated)).not.toMatch(SECRET);

      const listed = parseOpsPage(
        await (await app.request('/api/v1/ops/runs?status=failed&limit=1')).json(),
        parseOpsRun,
        'runs',
      );
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]?.id).toBe(runId);
      expect(listed.limit).toBe(1);
      const detail = parseOpsRunDetail(
        await (await app.request(`/api/v1/ops/runs/${runId}`)).json(),
      );
      expect(detail.requests[0]?.endpoint).toBe('view');
      expect(detail.requests[0]?.bizCode).toBe(-352);
      expect(detail.logs.length).toBe(1);
      expect(JSON.stringify(detail)).not.toMatch(SECRET);

      const bundleResponse = await app.request(`/api/v1/ops/debug/bundle?runId=${runId}`);
      expect(bundleResponse.status).toBe(200);
      const bundleText = await bundleResponse.text();
      expect(bundleText).not.toMatch(SECRET);
      expect(bundleText).not.toContain('plain-sess-value-9f3a');
      expect(bundleText).not.toContain('plain-jct-value-9f3a');
      expect(bundleText).not.toContain('pw-secret');
      expect(bundleText).not.toContain('ct-secret');
      const bundle = parseOpsDebugBundle(JSON.parse(bundleText) as unknown);
      expect(bundle.run?.id).toBe(runId);
      expect(bundle.video?.bvid).toBe('BV1xx411c7mD');
      expect(bundle.schemaVersion.startsWith('015_')).toBe(true);

      const live = parseOpsHealth(await (await app.request('/api/v1/ops/health')).json());
      expect(live.stale).toBe(false);
      expect(live.queueBacklog).toBe(0);
      expect(live.lastSuccessAt).toBeNull();

      const post = await app.request('/api/v1/ops/logs', { method: 'POST' });
      expect(post.status).toBe(404);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 30_000);
});
