import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  parseCollectorJob,
  parseMonitorTarget,
  parseMonitorTargetCreateResponse,
  parseOpsCollectorJobDetail,
  parseOpsCollectorJobList,
  parseOpsCollectorTargetSearch,
  parseOpsOperationList,
  parseOpsRunDetail,
  parseOpsSummary,
} from '@studio/contracts';
import {
  claimNextCollectorJob,
  commitBilibiliDynamic,
  createRetainedTestDatabase,
  writeDynamicSample,
  type Sql,
} from '@studio/db';
import {
  createBilibiliProvider,
  createMonitorProvider,
  installOfflineFetchGuard,
  readBilibiliRuntimeConfig,
  readCollectorConfig,
  runCollectorOnce,
  type CollectorConfig,
  type HttpTransport,
} from '@studio/monitoring';
import { createLogger } from '@studio/observability';
import { createApp } from './app';
import { createMonitorRoutes } from './monitor-routes';
import { createOpsRoutes } from './ops-routes';

installOfflineFetchGuard();

const guardedFetch = globalThis.fetch;
let bilibiliFetches = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/bilibili/i.test(url)) bilibiliFetches += 1;
  return guardedFetch(input, init);
}) as typeof fetch;

const ACTIVE_ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const EXPIRED_ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const fastConfig = (instanceId: string): CollectorConfig => ({
  ...readCollectorConfig({ COLLECTOR_INSTANCE_ID: instanceId }),
  pollMs: 20,
  maxAttempts: 3,
  backoffBaseMs: 0,
  backoffCapMs: 0,
  rateLimitMs: 0,
});

type Counts = {
  targets: number;
  jobs: number;
  runs: number;
  samples: number;
  logs: number;
};

describe('dynamic target execution', () => {
  let sql: Sql | null = null;
  let databaseName = '';
  let app: ReturnType<typeof createApp> | null = null;
  let apiLogger: ReturnType<typeof createLogger> | null = null;
  let collectorLogger: ReturnType<typeof createLogger> | null = null;

  beforeAll(async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_16c');
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    console.log(`retained dynamic execution database: ${databaseName}`);
    apiLogger = createLogger({ service: 'api', sql, instance: 'wp-r2-16c-api' });
    collectorLogger = createLogger({
      service: 'collector',
      sql,
      instance: 'wp-r2-16c-collector',
    });
    app = createApp({ skipDb: true, logger: apiLogger });
    app.route(
      '/api/v1/monitor',
      createMonitorRoutes(sql, {
        transport: async () => {
          throw new Error('验收传输不得访问 B 站');
        },
      }),
    );
    app.route('/api/v1/ops', createOpsRoutes(sql));
  }, 60_000);

  afterAll(async () => {
    if (apiLogger) await apiLogger.flush();
    if (collectorLogger) await collectorLogger.flush();
    if (sql) await sql.end({ timeout: 5 });
    expect(bilibiliFetches).toBe(0);
  });

  function db(): Sql {
    if (!sql || !app || !apiLogger || !collectorLogger) throw new Error('database missing');
    return sql;
  }

  async function postTarget(body: Record<string, unknown>) {
    if (!app) throw new Error('app missing');
    return app.request('/api/v1/monitor/targets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function counts(): Promise<Counts> {
    const rows = await db()<
      {
        targets: number;
        jobs: number;
        runs: number;
        samples: number;
        logs: number;
      }[]
    >`
      SELECT
        (SELECT count(*) FROM monitor_targets)::int AS targets,
        (SELECT count(*) FROM collector_jobs)::int AS jobs,
        (SELECT count(*) FROM collector_runs)::int AS runs,
        (SELECT count(*) FROM dynamic_metric_samples)::int AS samples,
        (SELECT count(*) FROM app_logs)::int AS logs
    `;
    const row = rows[0];
    if (!row) throw new Error('counts missing');
    return row;
  }

  async function readTarget(id: string) {
    const response = await app!.request('/api/v1/monitor/targets?pageSize=50');
    const body = (await response.json()) as { items: unknown[] };
    const found = body.items.map((item) => parseMonitorTarget(item)).find((item) => item.id === id);
    if (!found) throw new Error(`监控项 ${id} 不在列表中`);
    return found;
  }

  async function parkExcept(targetId: string) {
    await db()`
      UPDATE collector_jobs AS job
      SET scheduled_for = statement_timestamp() + interval '30 days' + (sub.n * interval '1 millisecond')
      FROM (
        SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
        FROM collector_jobs
        WHERE status = 'pending' AND target_id <> ${targetId}::uuid
      ) AS sub
      WHERE job.id = sub.id
    `;
  }

  async function runOffline(instanceId: string, now = new Date()) {
    if (!collectorLogger) throw new Error('logger missing');
    const outcome = await runCollectorOnce({
      sql: db(),
      provider: createMonitorProvider('offline', { SOURCE_TIMEZONE: 'Asia/Shanghai' }),
      config: fastConfig(instanceId),
      now,
      logger: collectorLogger,
      env: { COLLECTOR_SECRET_KEY: '' },
    });
    await collectorLogger.flush();
    return outcome;
  }

  test('rejects auto, illegal ids, and illegal frequency with no writes', async () => {
    const before = await counts();
    const auto = await postTarget({
      type: 'dynamic',
      externalId: '966692349750018048',
      intervalMode: 'auto',
    });
    expect(auto.status).toBe(400);
    expect(await auto.json()).toMatchObject({
      code: 'invalid_interval',
      error: '动态只支持固定间隔，不能使用自动频率',
    });
    for (const externalId of ['0', '01', 'BV1xx411c7mD', '12.5']) {
      const response = await postTarget({ type: 'dynamic', externalId, intervalMode: 'fixed' });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('十进制');
    }
    const frequency = await postTarget({
      type: 'dynamic',
      externalId: '966692349750018048',
      intervalMode: 'fixed',
      intervalMinutes: 4,
    });
    expect(frequency.status).toBe(400);
    expect(await counts()).toEqual(before);
    const constraint = await db()`
      INSERT INTO monitor_targets (
        id, "type", external_id, interval_minutes, interval_mode, next_run_at
      ) VALUES (
        ${crypto.randomUUID()}::uuid, 'dynamic', '12345', 60, 'auto', now()
      )
    `.catch((error: unknown) => error);
    expect(constraint).toBeInstanceOf(Error);
    expect(await counts()).toEqual(before);
  });

  test('creates one fixed dynamic, keeps a duplicate paused, and reads it back as text', async () => {
    const longId = `9${'0'.repeat(23)}1`;
    const created = parseMonitorTargetCreateResponse(
      await (await postTarget({ type: 'dynamic', externalId: longId, label: '长动态' })).json(),
    );
    expect(created.created).toBe(true);
    expect(created.target.externalId).toBe(longId);
    expect(created.target.intervalMode).toBe('fixed');
    expect(created.target.intervalMinutes).toBe(60);
    expect(created.target.type).toBe('dynamic');
    const listed = await app!.request('/api/v1/monitor/targets?pageSize=50');
    const items = ((await listed.json()) as { items: { externalId: string }[] }).items;
    expect(items.some((item) => item.externalId === longId)).toBe(true);

    const paused = await app!.request(`/api/v1/monitor/targets/${created.target.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(paused.status).toBe(200);
    const beforeJobs = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM collector_jobs WHERE target_id = ${created.target.id}::uuid
    `;
    const [againA, againB] = await Promise.all([
      postTarget({
        type: 'dynamic',
        externalId: longId,
        intervalMode: 'fixed',
        intervalMinutes: 15,
      }),
      postTarget({
        type: 'dynamic',
        externalId: longId,
        intervalMode: 'fixed',
        intervalMinutes: 15,
      }),
    ]);
    const duplicateA = parseMonitorTargetCreateResponse(await againA.json());
    const duplicateB = parseMonitorTargetCreateResponse(await againB.json());
    expect(duplicateA.created).toBe(false);
    expect(duplicateB.created).toBe(false);
    expect(duplicateA.target.id).toBe(created.target.id);
    expect(duplicateA.target.enabled).toBe(false);
    expect(duplicateA.target.intervalMinutes).toBe(60);
    expect(duplicateB.target.enabled).toBe(false);
    const afterJobs = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM collector_jobs WHERE target_id = ${created.target.id}::uuid
    `;
    expect(afterJobs[0]?.n).toBe(beforeJobs[0]?.n);
    await apiLogger!.flush();
    const operations = parseOpsOperationList(
      await (await app!.request(`/api/v1/ops/operations?targetId=${created.target.id}`)).json(),
    );
    expect(
      operations.items.some((item) => item.action === 'create' && item.targetType === 'dynamic'),
    ).toBe(true);
    expect(
      operations.items.some((item) => item.action === 'pause' && item.targetType === 'dynamic'),
    ).toBe(true);
  });

  test('pause skips new claims, an in-flight run finishes, and resume does not backfill', async () => {
    const dynamicId = '930000000000000001';
    const created = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'dynamic',
          externalId: dynamicId,
          intervalMode: 'fixed',
          intervalMinutes: 60,
        })
      ).json(),
    );
    const pauseFirst = await app!.request(`/api/v1/monitor/targets/${created.target.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(pauseFirst.status).toBe(200);
    await parkExcept(created.target.id);
    expect(await runOffline('dyn-paused')).toBe('idle');
    const resumed = await app!.request(`/api/v1/monitor/targets/${created.target.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(resumed.status).toBe(200);
    const samplesBefore = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM dynamic_metric_samples WHERE dynamic_id = ${dynamicId}
    `;
    expect(samplesBefore[0]?.n).toBe(0);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const real = createMonitorProvider('offline', { SOURCE_TIMEZONE: 'Asia/Shanghai' });
    const running = runCollectorOnce({
      sql: db(),
      provider: {
        id: 'offline',
        collectVideo: (externalId, sampledAt) => real.collectVideo(externalId, sampledAt),
        collectCreator: (externalId, sampledAt) => real.collectCreator(externalId, sampledAt),
        collectDynamic: async (externalId, sampledAt) => {
          entered();
          await gate;
          return real.collectDynamic(externalId, sampledAt);
        },
      },
      config: fastConfig('dyn-inflight'),
      logger: collectorLogger!,
      env: { COLLECTOR_SECRET_KEY: '' },
    });
    await started;
    const paused = await app!.request(`/api/v1/monitor/targets/${created.target.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(paused.status).toBe(200);
    expect(await claimNextCollectorJob(db())).toBeNull();
    release();
    expect(await running).toBe('succeeded');
    await collectorLogger!.flush();
    const samplesAfter = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM dynamic_metric_samples WHERE dynamic_id = ${dynamicId}
    `;
    expect(samplesAfter[0]?.n).toBe(1);
    expect(await runOffline('dyn-paused-after')).toBe('idle');

    const resume = await app!.request(`/api/v1/monitor/targets/${created.target.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(resume.status).toBe(200);
    const samplesResumed = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM dynamic_metric_samples WHERE dynamic_id = ${dynamicId}
    `;
    expect(samplesResumed[0]?.n).toBe(1);
    const jobs = await db()<{ status: string }[]>`
      SELECT status FROM collector_jobs WHERE target_id = ${created.target.id}::uuid ORDER BY created_at
    `;
    expect(jobs.map((job) => job.status)).toEqual(['succeeded', 'pending']);

    const removed = await app!.request(`/api/v1/monitor/targets/${created.target.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    expect(samplesResumed[0]?.n).toBe(1);
    const still = await db()<{ n: number; logs: number }[]>`
      SELECT
        (SELECT count(*) FROM dynamic_metric_samples WHERE dynamic_id = ${dynamicId})::int AS n,
        (SELECT count(*) FROM app_logs WHERE target_id = ${created.target.id}::uuid)::int AS logs
    `;
    expect(still[0]?.n).toBe(1);
    expect(still[0]?.logs ?? 0).toBeGreaterThan(0);
    expect(await claimNextCollectorJob(db())).toBeNull();
  });

  test('offline worker writes the scheduled bucket and ops reads that run', async () => {
    const dynamicId = '424242';
    await db()`
      INSERT INTO creators (mid, uname, face_url)
      VALUES (424242, '哨兵UP', 'https://example.invalid/face.jpg')
      ON CONFLICT (mid) DO UPDATE SET uname = '哨兵UP', face_url = 'https://example.invalid/face.jpg'
    `;
    const creator = parseMonitorTargetCreateResponse(
      await (await postTarget({ type: 'creator', externalId: dynamicId, label: '同号UP' })).json(),
    );
    const created = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'dynamic',
          externalId: dynamicId,
          label: '动态甲',
          intervalMode: 'fixed',
          intervalMinutes: 60,
        })
      ).json(),
    );
    const jobRow = await db()<{ id: string; scheduled_for: Date }[]>`
      SELECT id::text AS id, scheduled_for
      FROM collector_jobs
      WHERE target_id = ${created.target.id}::uuid AND status = 'pending'
    `;
    const scheduledFor = jobRow[0]?.scheduled_for;
    const jobId = jobRow[0]?.id;
    if (!scheduledFor || !jobId) throw new Error('job missing');
    const collectedAt = new Date(scheduledFor.getTime() + 90_000);
    await parkExcept(created.target.id);
    expect(await runOffline('dyn-offline', collectedAt)).toBe('succeeded');
    const sample = await db()<
      {
        like_count: string | null;
        source: string;
        account_id: string | null;
        collector_run_id: string | null;
        sampled_at: Date;
        collected_at: Date | null;
        mid: string | null;
      }[]
    >`
      SELECT s.like_count::text AS like_count, s.source, s.account_id::text AS account_id,
        s.collector_run_id::text AS collector_run_id, s.sampled_at, s.collected_at,
        d.mid::text AS mid
      FROM dynamic_metric_samples s
      JOIN dynamics d ON d.dynamic_id = s.dynamic_id
      WHERE s.dynamic_id = ${dynamicId}
    `;
    expect(sample).toHaveLength(1);
    expect(sample[0]?.source).toBe('import');
    expect(sample[0]?.account_id).toBeNull();
    expect(sample[0]?.mid).toBeNull();
    expect(sample[0]?.sampled_at.toISOString()).toBe(scheduledFor.toISOString());
    expect(sample[0]?.collected_at?.toISOString()).toBe(collectedAt.toISOString());
    expect(sample[0]?.collector_run_id).toBeTruthy();
    const runId = sample[0]?.collector_run_id ?? '';
    const target = await readTarget(created.target.id);
    expect(target.intervalMinutes).toBe(60);
    expect(target.intervalMode).toBe('fixed');
    const gap = Date.parse(target.nextRunAt ?? '') - Date.parse(target.lastSuccessAt ?? '');
    expect(gap).toBe(60 * 60_000);

    const metrics = await app!.request(`/api/v1/monitor/dynamics/${dynamicId}/metrics?limit=1`);
    expect(metrics.status).toBe(200);
    const metricBody = (await metrics.json()) as {
      dynamicId: string;
      items: { sampledAt: string; likeCount: string | null }[];
    };
    expect(metricBody.dynamicId).toBe(dynamicId);
    expect(metricBody.items).toHaveLength(1);
    expect(metricBody.items[0]?.sampledAt).toBe(scheduledFor.toISOString());
    const detail = (await (await app!.request(`/api/v1/monitor/dynamics/${dynamicId}`)).json()) as {
      dynamicId: string;
      mid: string | null;
      metadata: { text?: string };
    };
    expect(detail.dynamicId).toBe(dynamicId);
    expect(detail.mid).toBeNull();
    expect(detail.metadata.text).toBe(`离线动态 ${dynamicId}`);

    const jobs = parseOpsCollectorJobList(
      await (await app!.request('/api/v1/ops/collector-jobs?type=dynamic&pageSize=50')).json(),
    );
    const opsJob = jobs.items.find((item) => item.id === jobId);
    expect(opsJob?.targetType).toBe('dynamic');
    expect(opsJob?.externalId).toBe(dynamicId);
    expect(opsJob?.displayName).not.toBe('哨兵UP');
    expect(opsJob?.coverUrl).toBeNull();
    expect(opsJob?.projects).toEqual([]);
    const detailJob = parseOpsCollectorJobDetail(
      await (await app!.request(`/api/v1/ops/collector-jobs/${jobId}`)).json(),
    );
    expect(detailJob.job.targetType).toBe('dynamic');
    expect(detailJob.attempts.some((attempt) => attempt.id === runId)).toBe(true);
    const attempt = detailJob.attempts.find((item) => item.id === runId);
    expect(attempt?.logs.every((entry) => entry.runId === runId)).toBe(true);
    expect(attempt?.logs.length ?? 0).toBeGreaterThan(0);
    const run = parseOpsRunDetail(await (await app!.request(`/api/v1/ops/runs/${runId}`)).json());
    expect(run.run.id).toBe(runId);
    expect(run.run.targetId).toBe(created.target.id);
    expect(JSON.stringify(run)).not.toMatch(/SESSDATA|bili_jct/);
    const summary = parseOpsSummary(await (await app!.request('/api/v1/ops/summary')).json());
    expect(
      summary.targets.some(
        (item) => item.targetId === created.target.id && item.type === 'dynamic',
      ),
    ).toBe(true);
    const search = parseOpsCollectorTargetSearch(
      await (
        await app!.request(`/api/v1/ops/collector-targets?q=${dynamicId}&type=dynamic`)
      ).json(),
    );
    expect(
      search.items.some((item) => item.id === created.target.id && item.type === 'dynamic'),
    ).toBe(true);
    expect(search.items.some((item) => item.displayName === '哨兵UP')).toBe(false);
    expect(creator.target.type).toBe('creator');
    const creatorJobs = parseOpsCollectorJobList(
      await (
        await app!.request(`/api/v1/ops/collector-jobs?type=creator&externalId=${dynamicId}`)
      ).json(),
    );
    expect(creatorJobs.items.every((item) => item.targetType === 'creator')).toBe(true);
    expect(creatorJobs.items.some((item) => item.targetId === created.target.id)).toBe(false);
  });

  test('concurrent creates keep one target and concurrent runs keep one sample', async () => {
    const dynamicId = '940000000000000001';
    const body = {
      type: 'dynamic',
      externalId: dynamicId,
      intervalMode: 'fixed',
      intervalMinutes: 90,
    };
    const [first, second] = await Promise.all([postTarget(body), postTarget(body)]);
    const left = parseMonitorTargetCreateResponse(await first.json());
    const right = parseMonitorTargetCreateResponse(await second.json());
    const winners = [left, right].filter((item) => item.created);
    expect(winners).toHaveLength(1);
    const targetId = left.target.id;
    expect(right.target.id).toBe(targetId);
    const jobs = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM collector_jobs WHERE target_id = ${targetId}::uuid
    `;
    expect(jobs[0]?.n).toBe(1);
    await parkExcept(targetId);
    const [one, two] = await Promise.all([runOffline('dyn-race-a'), runOffline('dyn-race-b')]);
    expect([one, two].sort()).toEqual(['idle', 'succeeded']);
    const samples = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM dynamic_metric_samples WHERE dynamic_id = ${dynamicId}
    `;
    expect(samples[0]?.n).toBe(1);
  });

  test('injected transport writes null and zero without mixing two dynamics', async () => {
    await db()`
      INSERT INTO bili_accounts (id, mid, uname, status, is_default)
      VALUES (${ACTIVE_ACCOUNT}::uuid, 9001001, '采集号', 'active', true)
      ON CONFLICT (id) DO NOTHING
    `;
    const older = '910000000000000001';
    const newer = '910000000000000002';
    const urls: string[] = [];
    const transport: HttpTransport = async (request) => {
      urls.push(request.url);
      const path = new URL(request.url).pathname;
      if (path.endsWith('/view')) {
        return {
          status: 200,
          headers: {},
          durationMs: 1,
          body: JSON.stringify({
            code: 0,
            data: {
              bvid: 'BV1xx411c7mD',
              cid: 5,
              pubdate: 1_720_000_000,
              title: '示例',
              pic: 'https://i0.hdslb.com/a.jpg',
              owner: { mid: 7, name: 'UP' },
              stat: { view: 1, danmaku: 1, reply: 1, favorite: 1, coin: 1, share: 1, like: 1 },
            },
          }),
        };
      }
      if (path.endsWith('/online/total')) {
        return {
          status: 200,
          headers: {},
          durationMs: 1,
          body: JSON.stringify({ code: 0, data: { total: '3' } }),
        };
      }
      const id = new URL(request.url).searchParams.get('id') ?? '';
      const like = id === older ? 0 : 42;
      const comment = id === older ? null : 0;
      const repost = id === older ? 7 : null;
      const stat: Record<string, { count: number | null }> = {
        like: { count: like },
        forward: { count: repost },
      };
      if (comment !== null) stat.comment = { count: comment };
      return {
        status: 200,
        headers: {},
        durationMs: 2,
        body: JSON.stringify({
          code: 0,
          data: {
            item: {
              id_str: id,
              type: 'DYNAMIC_TYPE_WORD',
              visible: true,
              modules: {
                module_author: { mid: '9001', name: `作者${id}` },
                module_dynamic: { desc: { text: `正文${id}` } },
                module_stat: stat,
              },
            },
          },
        }),
      };
    };
    const provider = createBilibiliProvider(
      {
        ...readBilibiliRuntimeConfig({}),
        minIntervalMs: 0,
        maxJitterMs: 0,
        anonymousMinIntervalMs: 0,
      },
      { transport, sql: db(), random: () => 0 },
    );
    const first = parseMonitorTargetCreateResponse(
      await (
        await postTarget({ type: 'dynamic', externalId: older, intervalMode: 'fixed' })
      ).json(),
    );
    const second = parseMonitorTargetCreateResponse(
      await (
        await postTarget({ type: 'dynamic', externalId: newer, intervalMode: 'fixed' })
      ).json(),
    );
    const early = new Date('2020-01-01T00:00:00.000Z');
    await writeDynamicSample(db(), {
      dynamicId: older,
      likeCount: 1n,
      repostCount: 1n,
      commentCount: 1n,
      sampledAt: early,
      rawTime: '2020-01-01 08:00',
      sourceTimezone: 'Asia/Shanghai',
      timestampPrecision: 'second',
      source: 'import',
      accountId: null,
      collectorRunId: null,
      collectedAt: null,
      extra: {},
    });
    await parkExcept(first.target.id);
    expect(
      await runCollectorOnce({
        sql: db(),
        provider,
        config: fastConfig('dyn-inject-a'),
        logger: collectorLogger!,
        env: { COLLECTOR_ACCOUNT_ID: ACTIVE_ACCOUNT, COLLECTOR_SECRET_KEY: '' },
      }),
    ).toBe('succeeded');
    await db()`
      UPDATE collector_jobs
      SET scheduled_for = statement_timestamp()
      WHERE target_id = ${second.target.id}::uuid AND status = 'pending'
    `;
    await parkExcept(second.target.id);
    expect(
      await runCollectorOnce({
        sql: db(),
        provider,
        config: fastConfig('dyn-inject-b'),
        logger: collectorLogger!,
        env: { COLLECTOR_ACCOUNT_ID: ACTIVE_ACCOUNT, COLLECTOR_SECRET_KEY: '' },
      }),
    ).toBe('succeeded');
    await collectorLogger!.flush();
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes('/x/polymer/web-dynamic/v1/detail?id='))).toBe(true);
    expect(
      urls.some((url) => /nav|qrcode|space\/dynamic|polymer\/web-dynamic\/v1\/feed/i.test(url)),
    ).toBe(false);

    const rows = await db()<
      {
        dynamic_id: string;
        like_count: string | null;
        comment_count: string | null;
        repost_count: string | null;
        source: string;
        account_id: string | null;
        sampled_at: Date;
        scheduled_for: Date;
      }[]
    >`
      SELECT s.dynamic_id, s.like_count::text AS like_count, s.comment_count::text AS comment_count,
        s.repost_count::text AS repost_count, s.source, s.account_id::text AS account_id,
        s.sampled_at, j.scheduled_for
      FROM dynamic_metric_samples s
      JOIN collector_runs r ON r.id = s.collector_run_id
      JOIN collector_jobs j ON j.id = r.job_id
      WHERE s.dynamic_id IN (${older}, ${newer}) AND s.source = 'bilibili'
    `;
    const byId = new Map(rows.map((row) => [row.dynamic_id, row]));
    expect(byId.get(older)).toMatchObject({
      like_count: '0',
      comment_count: null,
      repost_count: '7',
      source: 'bilibili',
      account_id: ACTIVE_ACCOUNT,
    });
    expect(byId.get(newer)).toMatchObject({
      like_count: '42',
      comment_count: '0',
      repost_count: null,
      account_id: ACTIVE_ACCOUNT,
    });
    expect(byId.get(older)?.sampled_at.toISOString()).toBe(
      byId.get(older)?.scheduled_for.toISOString(),
    );
    expect(byId.get(newer)?.sampled_at.toISOString()).toBe(
      byId.get(newer)?.scheduled_for.toISOString(),
    );
    const latest = (await (
      await app!.request(`/api/v1/monitor/dynamics/${older}/metrics?limit=1`)
    ).json()) as {
      items: { sampledAt: string; likeCount: string | null; commentCount: string | null }[];
    };
    expect(latest.items).toHaveLength(1);
    expect(latest.items[0]?.likeCount).toBe('0');
    expect(latest.items[0]?.commentCount).toBeNull();
    expect(latest.items[0]?.sampledAt).not.toBe(early.toISOString());
    const other = (await (
      await app!.request(`/api/v1/monitor/dynamics/${newer}/metrics?limit=5`)
    ).json()) as { items: { likeCount: string | null; repostCount: string | null }[] };
    expect(other.items.some((item) => item.likeCount === '0' && item.repostCount === '7')).toBe(
      false,
    );
    const creators = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM monitor_targets
      WHERE "type" = 'creator' AND external_id = '9001'
    `;
    expect(creators[0]?.n).toBe(0);

    const before = urls.length;
    await provider.fetchVideo({
      bvid: 'BV1xx411c7mD',
      sampledAt: new Date(),
      collectedAt: new Date(),
      cookieHeader: null,
      accountKey: ACTIVE_ACCOUNT,
    });
    const rate = await db()<{ count: number; n: number }[]>`
      SELECT count::int AS count, (SELECT count(*) FROM collector_rate_state WHERE account_id = ${ACTIVE_ACCOUNT}::uuid)::int AS n
      FROM collector_rate_state WHERE account_id = ${ACTIVE_ACCOUNT}::uuid
    `;
    expect(rate[0]?.n).toBe(1);
    expect(rate[0]?.count).toBe(before + 2);
  });

  test('a repeated bucket keeps the old sample and a failed commit leaves nothing', async () => {
    const dynamicId = '950000000000000001';
    const created = parseMonitorTargetCreateResponse(
      await (
        await postTarget({ type: 'dynamic', externalId: dynamicId, intervalMode: 'fixed' })
      ).json(),
    );
    const pending = await db()<{ id: string }[]>`
      SELECT id::text AS id FROM collector_jobs
      WHERE target_id = ${created.target.id}::uuid AND status = 'pending'
    `;
    const jobId = pending[0]?.id;
    if (!jobId) throw new Error('pending job missing');
    const scheduledFor = new Date('2026-10-21T04:05:06.000Z');
    await db()`
      UPDATE collector_jobs SET scheduled_for = ${scheduledFor}
      WHERE id = ${jobId}::uuid
    `;
    await writeDynamicSample(db(), {
      dynamicId,
      likeCount: 8n,
      repostCount: null,
      commentCount: 0n,
      sampledAt: scheduledFor,
      rawTime: '2026-10-21 12:00',
      sourceTimezone: 'Asia/Shanghai',
      timestampPrecision: 'second',
      source: 'import',
      accountId: null,
      collectorRunId: null,
      collectedAt: null,
      extra: { marker: 'old' },
    });
    await parkExcept(created.target.id);
    expect(await runOffline('dyn-dup', new Date(scheduledFor.getTime() + 5_000))).toBe('succeeded');
    const kept = await db()<
      {
        source: string;
        like_count: string | null;
        samples_written: number;
        extra: { marker?: string };
      }[]
    >`
      SELECT s.source, s.like_count::text AS like_count, r.samples_written, s.extra
      FROM dynamic_metric_samples s
      JOIN collector_runs r ON r.job_id = ${jobId}::uuid
      WHERE s.dynamic_id = ${dynamicId} AND s.sampled_at = ${scheduledFor}
    `;
    expect(kept).toHaveLength(1);
    expect(kept[0]?.source).toBe('import');
    expect(kept[0]?.like_count).toBe('8');
    expect(kept[0]?.extra.marker).toBe('old');
    expect(kept[0]?.samples_written).toBe(0);

    const rollbackId = '960000000000000001';
    const rollbackTarget = parseMonitorTargetCreateResponse(
      await (
        await postTarget({ type: 'dynamic', externalId: rollbackId, intervalMode: 'fixed' })
      ).json(),
    );
    await parkExcept(rollbackTarget.target.id);
    const claimed = await claimNextCollectorJob(db());
    if (!claimed || claimed.targetId !== rollbackTarget.target.id) throw new Error('claim missed');
    const failure = await commitBilibiliDynamic(db(), {
      jobId: claimed.id,
      targetId: claimed.targetId,
      startedAt: new Date(),
      durationMs: 1,
      schedule: { minutes: 60, persistMinutes: false },
      sample: {
        dynamicId: rollbackId,
        likeCount: 3n,
        repostCount: 3n,
        commentCount: 3n,
        sampledAt: claimed.scheduledFor,
        rawTime: '2026-10-21 12:01',
        sourceTimezone: 'Asia/Shanghai',
        timestampPrecision: 'second',
        source: 'bilibili',
        accountId: crypto.randomUUID(),
        collectorRunId: null,
        collectedAt: new Date(),
        extra: {},
      },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    const left = await db()<{ samples: number; runs: number; status: string }[]>`
      SELECT
        (SELECT count(*) FROM dynamic_metric_samples WHERE dynamic_id = ${rollbackId})::int AS samples,
        (SELECT count(*) FROM collector_runs WHERE job_id = ${claimed.id}::uuid)::int AS runs,
        (SELECT status FROM collector_jobs WHERE id = ${claimed.id}::uuid) AS status
    `;
    expect(left[0]).toEqual({ samples: 0, runs: 0, status: 'running' });
  });

  test('risk, expiry, not found, and network failures write no sample', async () => {
    await db()`
      INSERT INTO bili_accounts (id, mid, uname, status, is_default)
      VALUES (${EXPIRED_ACCOUNT}::uuid, 9001002, '过期号', 'expired', false)
      ON CONFLICT (id) DO NOTHING
    `;
    await db()`UPDATE bili_accounts SET is_default = false WHERE is_default = true`;
    await db()`DELETE FROM collector_circuits`;
    const cases: Array<{
      id: string;
      kind: 'risk' | 'risk412' | 'missing' | 'network' | 'limited' | 'expired' | 'parse';
    }> = [
      { id: '920000000000000001', kind: 'risk' },
      { id: '920000000000000002', kind: 'risk412' },
      { id: '920000000000000003', kind: 'missing' },
      { id: '920000000000000004', kind: 'network' },
      { id: '920000000000000005', kind: 'limited' },
      { id: '920000000000000006', kind: 'expired' },
      { id: '920000000000000007', kind: 'parse' },
    ];
    for (const item of cases) {
      const urls: string[] = [];
      const transport: HttpTransport = async (request) => {
        urls.push(request.url);
        if (item.kind === 'network') throw new Error('socket down SESSDATA=super-secret');
        if (item.kind === 'missing') {
          return {
            status: 404,
            headers: {},
            durationMs: 1,
            body: JSON.stringify({ code: -404, message: 'gone' }),
          };
        }
        if (item.kind === 'risk') {
          return {
            status: 200,
            headers: {},
            durationMs: 1,
            body: JSON.stringify({ code: -352, message: '风控' }),
          };
        }
        if (item.kind === 'risk412') {
          return {
            status: 412,
            headers: {},
            durationMs: 1,
            body: JSON.stringify({ code: -412, message: '风控' }),
          };
        }
        if (item.kind === 'limited') {
          return {
            status: 200,
            headers: {},
            durationMs: 1,
            body: JSON.stringify({ code: -509, message: '频繁' }),
          };
        }
        return {
          status: 200,
          headers: {},
          durationMs: 1,
          body: JSON.stringify({ code: 0, data: { item: {} } }),
        };
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
      const created = parseMonitorTargetCreateResponse(
        await (
          await postTarget({ type: 'dynamic', externalId: item.id, intervalMode: 'fixed' })
        ).json(),
      );
      await parkExcept(created.target.id);
      const outcome = await runCollectorOnce({
        sql: db(),
        provider,
        config: fastConfig(`dyn-fail-${item.kind}`),
        logger: collectorLogger!,
        env: {
          COLLECTOR_SECRET_KEY: '',
          ...(item.kind === 'expired' ? { COLLECTOR_ACCOUNT_ID: EXPIRED_ACCOUNT } : {}),
        },
      });
      await collectorLogger!.flush();
      const state = await db()<
        {
          samples: number;
          requests: number;
          runs: number;
          run_id: string | null;
          job_id: string;
          endpoint: string | null;
          error: string | null;
        }[]
      >`
        SELECT
          (SELECT count(*) FROM dynamic_metric_samples WHERE dynamic_id = ${item.id})::int AS samples,
          (SELECT count(*) FROM collector_requests r JOIN collector_runs run ON run.id = r.run_id
            WHERE run.target_id = ${created.target.id}::uuid)::int AS requests,
          (SELECT count(*) FROM collector_runs WHERE target_id = ${created.target.id}::uuid)::int AS runs,
          (SELECT id::text FROM collector_runs WHERE target_id = ${created.target.id}::uuid ORDER BY finished_at DESC LIMIT 1) AS run_id,
          (SELECT id::text FROM collector_jobs WHERE target_id = ${created.target.id}::uuid ORDER BY created_at DESC LIMIT 1) AS job_id,
          (SELECT endpoint FROM collector_requests r JOIN collector_runs run ON run.id = r.run_id
            WHERE run.target_id = ${created.target.id}::uuid LIMIT 1) AS endpoint,
          (SELECT error FROM collector_runs WHERE target_id = ${created.target.id}::uuid ORDER BY finished_at DESC LIMIT 1) AS error
      `;
      const row = state[0];
      if (!row) throw new Error('state missing');
      expect(row.samples).toBe(0);
      if (item.kind === 'expired') {
        expect(outcome).toBe('deferred');
        expect(urls).toEqual([]);
        expect(row.runs).toBe(0);
        expect(row.requests).toBe(0);
      } else {
        expect(outcome).toBe('failed');
        expect(urls).toHaveLength(1);
        expect(urls[0]).toContain(`/x/polymer/web-dynamic/v1/detail?id=${item.id}`);
        expect(urls[0]).not.toMatch(/nav|qrcode|feed/i);
        expect(row.runs).toBe(1);
        expect(row.requests).toBe(1);
        expect(row.endpoint).toBe('dynamic_detail');
        expect(row.run_id).toBeTruthy();
        const logs = await db()<{ n: number; foreign: number }[]>`
          SELECT
            count(*)::int AS n,
            count(*) FILTER (WHERE job_id IS DISTINCT FROM ${row.job_id}::uuid AND run_id IS DISTINCT FROM ${row.run_id}::uuid)::int AS foreign
          FROM app_logs
          WHERE job_id = ${row.job_id}::uuid OR run_id = ${row.run_id}::uuid
        `;
        expect(logs[0]?.n ?? 0).toBeGreaterThan(0);
        expect(logs[0]?.foreign).toBe(0);
        const http = parseOpsRunDetail(
          await (await app!.request(`/api/v1/ops/runs/${row.run_id}`)).json(),
        );
        expect(http.requests).toHaveLength(1);
        expect(http.requests[0]?.runId).toBe(row.run_id);
        expect(http.requests[0]?.endpoint).toBe('dynamic_detail');
        expect(JSON.stringify(http)).not.toContain('super-secret');
      }
    }
  });

  test('manual run is recorded and video plus creator intervals stay on their policies', async () => {
    const dynamicId = '970000000000000001';
    const created = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'dynamic',
          externalId: dynamicId,
          intervalMode: 'fixed',
          intervalMinutes: 120,
        })
      ).json(),
    );
    // Create already inserted one pending; manual must reuse it (one opportunity).
    const manualReuse = await app!.request(`/api/v1/monitor/targets/${created.target.id}/run`, {
      method: 'POST',
    });
    expect(manualReuse.status).toBe(200);
    const reuseBody = (await manualReuse.json()) as { created: boolean; job: unknown };
    expect(reuseBody.created).toBe(false);
    const reused = parseCollectorJob(reuseBody.job);
    expect(reused.targetType).toBe('dynamic');
    expect(reused.externalId).toBe(dynamicId);

    // Finish that opportunity so a true new manual job (and ops run row) can be created.
    await sql!`
      UPDATE collector_jobs
      SET status = 'succeeded', finished_at = statement_timestamp(), updated_at = statement_timestamp()
      WHERE id = ${reused.id}::uuid
    `;
    const manual = await app!.request(`/api/v1/monitor/targets/${created.target.id}/run`, {
      method: 'POST',
    });
    expect(manual.status).toBe(200);
    const body = (await manual.json()) as { created: boolean; job: unknown };
    expect(body.created).toBe(true);
    const job = parseCollectorJob(body.job);
    expect(job.targetType).toBe('dynamic');
    expect(job.externalId).toBe(dynamicId);
    expect(job.id).not.toBe(reused.id);
    await apiLogger!.flush();
    const operations = parseOpsOperationList(
      await (
        await app!.request(`/api/v1/ops/operations?targetId=${created.target.id}&action=run`)
      ).json(),
    );
    expect(
      operations.items.some((item) => item.action === 'run' && item.targetType === 'dynamic'),
    ).toBe(true);

    const autoPatch = await app!.request(`/api/v1/monitor/targets/${created.target.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intervalMode: 'auto' }),
    });
    expect(autoPatch.status).toBe(400);
    const unchanged = await readTarget(created.target.id);
    expect(unchanged.intervalMode).toBe('fixed');
    expect(unchanged.intervalMinutes).toBe(120);

    const video = parseMonitorTargetCreateResponse(
      await (await postTarget({ type: 'video', externalId: 'BV1xx411c7mD' })).json(),
    );
    const creator = parseMonitorTargetCreateResponse(
      await (await postTarget({ type: 'creator', externalId: '12345' })).json(),
    );
    await db()`
      UPDATE collector_jobs AS job
      SET scheduled_for = statement_timestamp() + interval '30 days' + (sub.n * interval '1 millisecond')
      FROM (
        SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
        FROM collector_jobs
        WHERE status = 'pending'
          AND target_id NOT IN (${video.target.id}::uuid, ${creator.target.id}::uuid)
      ) AS sub
      WHERE job.id = sub.id
    `;
    const outcomes = [await runOffline('reg-a'), await runOffline('reg-b')].sort();
    expect(outcomes).toEqual(['succeeded', 'succeeded']);
    const videoTarget = await readTarget(video.target.id);
    const creatorTarget = await readTarget(creator.target.id);
    expect(videoTarget.intervalMode).toBe('auto');
    expect(videoTarget.intervalMinutes).toBe(15);
    expect(creatorTarget.intervalMode).toBe('auto');
    expect(creatorTarget.intervalMinutes).toBe(240);
  });
});
