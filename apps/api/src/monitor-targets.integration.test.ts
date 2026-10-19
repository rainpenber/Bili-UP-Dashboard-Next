import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  MonitorContractError,
  parseMonitorTargetCreateResponse,
  parseMonitorTargetList,
} from '@studio/contracts';
import {
  claimNextCollectorJob,
  countSamplesAt,
  createIsolatedTestDatabase,
  createSql,
  dropIsolatedTestDatabase,
  enqueueDueCollectorJobs,
  readDbConfigFromEnv,
  writeVideoSample,
  type Sql,
} from '@studio/db';
import {
  createMonitorProvider,
  runCollectorLoop,
  runCollectorOnce,
  truncateToUtcMinute,
  type CollectorConfig,
  type MonitorProvider,
} from '@studio/monitoring';
import { createApp } from './app';
import { createMonitorRoutes } from './monitor-routes';

const fastConfig = (instanceId: string, maxAttempts = 3): CollectorConfig => ({
  pollMs: 20,
  maxAttempts,
  backoffBaseMs: 0,
  backoffCapMs: 0,
  rateLimitMs: 0,
  instanceId,
});

describe('monitor targets and offline collector', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let app: ReturnType<typeof createApp> | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (!sql) return;
    app = createApp({ skipDb: true });
    app.route('/api/v1/monitor', createMonitorRoutes(sql));
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  async function postTarget(body: Record<string, unknown>) {
    if (!app) throw new Error('app missing');
    return app.request('/api/v1/monitor/targets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function parkOtherPending(targetId: string) {
    if (!sql) return;
    await sql`
      UPDATE collector_jobs
      SET scheduled_for = statement_timestamp() + interval '7 days'
      WHERE status = 'pending' AND target_id <> ${targetId}::uuid
    `;
  }

  test('adds a BV and a UID, the collector writes samples, and reads show last success', async () => {
    if (!sql || !app) return;
    const db = sql;
    const video = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'video',
          externalId: 'BV1xx411c7mD',
          label: '离线视频',
          tags: ['demo'],
        })
      ).json(),
    );
    const creator = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'creator',
          externalId: '12345',
          label: '离线 UP',
          intervalMinutes: 15,
        })
      ).json(),
    );
    expect(video.created).toBe(true);
    expect(creator.created).toBe(true);

    const provider = createMonitorProvider('offline', { SOURCE_TIMEZONE: 'Asia/Shanghai' });
    const outcomes = [
      await runCollectorOnce({ sql: db, provider, config: fastConfig('e2e-a') }),
      await runCollectorOnce({ sql: db, provider, config: fastConfig('e2e-b') }),
    ];
    expect(outcomes.sort()).toEqual(['succeeded', 'succeeded']);

    const listed = parseMonitorTargetList(
      await (await app.request('/api/v1/monitor/targets?page=1')).json(),
    );
    const videoRow = listed.items.find((item) => item.id === video.target.id);
    const creatorRow = listed.items.find((item) => item.id === creator.target.id);
    expect(videoRow?.lastSuccessAt).toBeTruthy();
    expect(videoRow?.lastError).toBeNull();
    expect(videoRow?.nextRunAt).toBeTruthy();
    expect(creatorRow?.lastSuccessAt).toBeTruthy();
    expect(creatorRow?.intervalMinutes).toBe(15);

    const metrics = await app.request('/api/v1/monitor/videos/BV1xx411c7mD/metrics?limit=10');
    expect(metrics.status).toBe(200);
    const metricBody = (await metrics.json()) as {
      items: { viewCount: string | null; sampledAt: string }[];
    };
    expect(metricBody.items.length).toBeGreaterThan(0);
    expect(metricBody.items.at(-1)?.viewCount).toMatch(/^\d+$/);

    const fans = await app.request('/api/v1/monitor/creators/12345/metrics?limit=10');
    const fanBody = (await fans.json()) as { items: { followerCount: string }[] };
    expect(fanBody.items.length).toBeGreaterThan(0);

    const jobs = await app.request('/api/v1/monitor/jobs?page=1&pageSize=8');
    const jobBody = (await jobs.json()) as {
      items: { status: string; latestRun: { samplesWritten: number } | null }[];
    };
    expect(
      jobBody.items.some(
        (item) => item.status === 'succeeded' && item.latestRun?.samplesWritten === 1,
      ),
    ).toBe(true);
  });

  test('duplicate add returns the existing row and a visible code', async () => {
    if (!sql || !app) return;
    const first = parseMonitorTargetCreateResponse(
      await (await postTarget({ type: 'video', externalId: 'BV1xx411c7mE' })).json(),
    );
    const secondResponse = await postTarget({
      type: 'video',
      externalId: 'BV1xx411c7mE',
      label: '另一条',
    });
    expect(secondResponse.status).toBe(200);
    const second = parseMonitorTargetCreateResponse(await secondResponse.json());
    expect(second.created).toBe(false);
    expect(second.code).toBe('target_exists');
    expect(second.message).toContain('已存在');
    expect(second.target.id).toBe(first.target.id);
    expect(second.target.label).toBe(first.target.label);
    const [count] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM monitor_targets
      WHERE "type" = 'video' AND external_id = 'BV1xx411c7mE' AND deleted_at IS NULL
    `;
    expect(count?.count).toBe('1');
  });

  test('illegal BV, unknown id, deleted target, and illegal interval are visible errors', async () => {
    if (!sql || !app) return;
    const bad = await postTarget({ type: 'video', externalId: 'BVTEST001' });
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { error: string; code: string };
    expect(badBody.code).toBe('invalid_external_id');
    expect(badBody.error).toContain('BV');

    const interval = await postTarget({ type: 'creator', externalId: '88', intervalMinutes: 7 });
    expect(interval.status).toBe(400);
    expect(((await interval.json()) as { code: string }).code).toBe('invalid_interval');

    const missing = await app.request(
      '/api/v1/monitor/targets/00000000-0000-4000-8000-000000000000',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toContain('不存在');

    const created = parseMonitorTargetCreateResponse(
      await (await postTarget({ type: 'creator', externalId: '99' })).json(),
    );
    const removed = await app.request(`/api/v1/monitor/targets/${created.target.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    const again = await app.request(`/api/v1/monitor/targets/${created.target.id}/run`, {
      method: 'POST',
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string; error: string }).error).toContain('已删除');
    const active = parseMonitorTargetList(
      await (await app.request('/api/v1/monitor/targets')).json(),
    );
    expect(active.items.some((item) => item.id === created.target.id)).toBe(false);
  });

  test('paused targets do not gain jobs, and resume can run', async () => {
    if (!sql || !app) return;
    const db = sql;
    const created = parseMonitorTargetCreateResponse(
      await (await postTarget({ type: 'video', externalId: 'BV1xx411c7mF' })).json(),
    );
    const paused = await app.request(`/api/v1/monitor/targets/${created.target.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(paused.status).toBe(200);
    await parkOtherPending(created.target.id);
    await db`
      UPDATE monitor_targets
      SET next_run_at = statement_timestamp() - interval '1 hour'
      WHERE id = ${created.target.id}::uuid
    `;
    const [before] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM collector_jobs WHERE target_id = ${created.target.id}::uuid
    `;
    await enqueueDueCollectorJobs(db);
    expect(
      await runCollectorOnce({
        sql: db,
        provider: createMonitorProvider('offline'),
        config: fastConfig('pause'),
      }),
    ).toBe('idle');
    const [after] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM collector_jobs WHERE target_id = ${created.target.id}::uuid
    `;
    expect(after?.count).toBe(before?.count);

    const resumed = await app.request(`/api/v1/monitor/targets/${created.target.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(resumed.status).toBe(200);
    expect(
      await runCollectorOnce({
        sql: db,
        provider: createMonitorProvider('offline', { SOURCE_TIMEZONE: 'Asia/Shanghai' }),
        config: fastConfig('resume'),
      }),
    ).toBe('succeeded');
  });

  test('soft delete keeps samples and does not enqueue', async () => {
    if (!sql || !app) return;
    const db = sql;
    const created = parseMonitorTargetCreateResponse(
      await (await postTarget({ type: 'video', externalId: 'BV1xx411c7mG' })).json(),
    );
    await parkOtherPending(created.target.id);
    expect(
      await runCollectorOnce({
        sql: db,
        provider: createMonitorProvider('offline'),
        config: fastConfig('delete-run'),
      }),
    ).toBe('succeeded');
    const [samplesBefore] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM video_metric_samples WHERE bvid = 'BV1xx411c7mG'
    `;
    const removed = await app.request(`/api/v1/monitor/targets/${created.target.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    await db`
      UPDATE monitor_targets SET next_run_at = statement_timestamp() - interval '1 hour'
      WHERE id = ${created.target.id}::uuid
    `;
    expect(await enqueueDueCollectorJobs(db)).toBe(0);
    expect(
      await runCollectorOnce({
        sql: db,
        provider: createMonitorProvider('offline'),
        config: fastConfig('delete-idle'),
      }),
    ).toBe('idle');
    const manual = await app.request(`/api/v1/monitor/targets/${created.target.id}/run`, {
      method: 'POST',
    });
    expect(manual.status).toBe(409);
    const [samplesAfter] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM video_metric_samples WHERE bvid = 'BV1xx411c7mG'
    `;
    expect(samplesAfter?.count).toBe(samplesBefore?.count);
    expect(Number(samplesAfter?.count)).toBeGreaterThan(0);
  });

  test('repeating the same sample instant does not insert or overwrite', async () => {
    if (!sql) return;
    const provider = createMonitorProvider('offline', { SOURCE_TIMEZONE: 'Asia/Shanghai' });
    const minute = truncateToUtcMinute(new Date('2026-10-19T01:02:03.000Z'));
    const sample = await provider.collectVideo('BV1xx411c7mH', minute);
    expect(await writeVideoSample(sql, sample)).toBe(true);
    expect(await writeVideoSample(sql, { ...sample, viewCount: sample.viewCount + 9n })).toBe(
      false,
    );
    expect(
      await countSamplesAt(sql, {
        kind: 'video',
        externalId: 'BV1xx411c7mH',
        sampledAt: sample.sampledAt,
      }),
    ).toBe(1);
    const [row] = await sql<{ view_count: string }[]>`
      SELECT view_count::text AS view_count FROM video_metric_samples
      WHERE bvid = 'BV1xx411c7mH' AND sampled_at = ${sample.sampledAt}
    `;
    expect(row?.view_count).toBe(sample.viewCount.toString());
  });

  test('missing fixture fails the job and stops at the attempt cap', async () => {
    if (!sql || !app) return;
    const db = sql;
    const created = parseMonitorTargetCreateResponse(
      await (await postTarget({ type: 'video', externalId: 'BV1xx411c7mJ' })).json(),
    );
    await parkOtherPending(created.target.id);
    const provider = createMonitorProvider('offline', {
      MOCK_DATA_ROOT: '/tmp/studio-r205-missing-fixture',
    });
    const config = fastConfig('fail-cap', 2);
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('failed');
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('failed');
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('idle');
    const [job] = await db<{ status: string; attempts: number; error: string | null }[]>`
      SELECT status, attempts, error FROM collector_jobs WHERE target_id = ${created.target.id}::uuid
    `;
    expect(job?.status).toBe('failed');
    expect(job?.attempts).toBe(2);
    expect(job?.error ?? '').toContain('离线夹具');
    const [runs] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM collector_runs WHERE target_id = ${created.target.id}::uuid
    `;
    expect(runs?.count).toBe('2');
    const listed = parseMonitorTargetList(
      await (await app.request('/api/v1/monitor/targets')).json(),
    );
    expect(listed.items.find((item) => item.id === created.target.id)?.lastError ?? '').toContain(
      '离线夹具',
    );
  });

  test('two connections claim the same pending job only once', async () => {
    if (!sql || !databaseName || !app) return;
    const created = parseMonitorTargetCreateResponse(
      await (await postTarget({ type: 'creator', externalId: '4242' })).json(),
    );
    await parkOtherPending(created.target.id);
    const other = createSql({ ...readDbConfigFromEnv(), database: databaseName });
    try {
      const [first, second] = await Promise.all([
        claimNextCollectorJob(sql),
        claimNextCollectorJob(other),
      ]);
      const claimed = [first, second].filter((job) => job !== null);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.targetId).toBe(created.target.id);
      expect(claimed[0]?.attempts).toBe(1);
      const third = await claimNextCollectorJob(sql);
      expect(third).toBeNull();
    } finally {
      await other.end({ timeout: 5 });
    }
  });

  test('abort finishes the current task and writes a stopped heartbeat', async () => {
    if (!sql || !app) return;
    const db = sql;
    const created = parseMonitorTargetCreateResponse(
      await (await postTarget({ type: 'video', externalId: 'BV1xx411c7mK' })).json(),
    );
    await parkOtherPending(created.target.id);
    const abort = new AbortController();
    const real = createMonitorProvider('offline');
    const provider: MonitorProvider = {
      id: 'offline',
      collectVideo: async (externalId, sampledAt) => {
        abort.abort();
        return real.collectVideo(externalId, sampledAt);
      },
      collectCreator: (externalId, sampledAt) => real.collectCreator(externalId, sampledAt),
    };
    await runCollectorLoop({
      sql: db,
      provider,
      config: fastConfig('shutdown'),
      signal: abort.signal,
      log: () => undefined,
    });
    const [beat] = await db<{ status: string }[]>`
      SELECT status FROM collector_heartbeats WHERE instance_id = 'shutdown'
    `;
    expect(beat?.status).toBe('stopped');
    const [job] = await db<{ status: string }[]>`
      SELECT status FROM collector_jobs WHERE target_id = ${created.target.id}::uuid
    `;
    expect(job?.status).toBe('succeeded');
  });
});

describe('contract error type stays exported for callers', () => {
  test('MonitorContractError is constructable', () => {
    const error = new MonitorContractError('invalid_external_id', 'BV 号格式不正确');
    expect(error.code).toBe('invalid_external_id');
  });
});
