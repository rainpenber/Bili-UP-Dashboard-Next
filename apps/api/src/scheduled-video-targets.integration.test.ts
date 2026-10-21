/**
 * WP-R2-17A: planned startAt for video targets — real PG + app.request.
 * Fail-closed: REQUIRE_POSTGRES / createRetainedTestDatabase. Retains wp_r2_17a_*.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  parseMonitorTarget,
  parseMonitorTargetCreateResponse,
  parseOpsOperationList,
} from '@studio/contracts';
import {
  claimNextCollectorJob,
  createRetainedTestDatabase,
  createSql,
  enqueueDueCollectorJobs,
  readDbConfigFromEnv,
  writeVideoSample,
  type Sql,
} from '@studio/db';
import {
  createMonitorProvider,
  installOfflineFetchGuard,
  runCollectorOnce,
  type CollectorConfig,
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

const fastConfig = (instanceId: string): CollectorConfig => ({
  pollMs: 20,
  maxAttempts: 3,
  backoffBaseMs: 0,
  backoffCapMs: 0,
  rateLimitMs: 0,
  instanceId,
});

function futureIso(hoursAhead: number): string {
  return new Date(Date.now() + hoursAhead * 3600_000).toISOString();
}

function pastIso(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3600_000).toISOString();
}

describe('scheduled video targets (WP-R2-17A)', () => {
  let sql: Sql | null = null;
  let databaseName = '';
  let app: ReturnType<typeof createApp> | null = null;
  let apiLogger: ReturnType<typeof createLogger> | null = null;

  beforeAll(async () => {
    process.env.REQUIRE_POSTGRES = '1';
    const isolated = await createRetainedTestDatabase('wp_r2_17a');
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    console.log(`retained scheduled-video database: ${databaseName}`);
    apiLogger = createLogger({ service: 'api', sql, instance: 'wp-r2-17a-api' });
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
    if (sql) await sql.end({ timeout: 5 });
    expect(bilibiliFetches).toBe(0);
  });

  function db(): Sql {
    if (!sql || !app) throw new Error('database missing');
    return sql;
  }

  async function postTarget(body: Record<string, unknown>) {
    return app!.request('/api/v1/monitor/targets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function patchTarget(id: string, body: Record<string, unknown>) {
    return app!.request(`/api/v1/monitor/targets/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function parkExcept(targetId: string) {
    await db()`
      UPDATE collector_jobs
      SET scheduled_for = statement_timestamp() + interval '14 days'
      WHERE status = 'pending' AND target_id <> ${targetId}::uuid
    `;
  }

  async function pendingCount(targetId: string): Promise<number> {
    const [row] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM collector_jobs
      WHERE target_id = ${targetId}::uuid AND status = 'pending'
    `;
    return row?.n ?? 0;
  }

  test('migration 013 adds start_at and is idempotent', async () => {
    const cols = await db()<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'monitor_targets' AND column_name = 'start_at'
    `;
    expect(cols).toHaveLength(1);
    const versions = await db()<{ version: string }[]>`
      SELECT version FROM schema_migrations WHERE version LIKE '013_%'
    `;
    expect(versions.some((row) => row.version.startsWith('013_'))).toBe(true);
  });

  test('future create → read startAt → idle with zero transport → due after reschedule to past', async () => {
    const startAt = futureIso(6);
    const created = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'video',
          externalId: 'BV1xx411c7mA',
          label: '定时视频',
          startAt,
        })
      ).json(),
    );
    expect(created.created).toBe(true);
    expect(created.target.startAt).toBe(startAt);
    expect(created.target.nextRunAt).toBe(startAt);
    expect(await pendingCount(created.target.id)).toBe(0);

    await parkExcept(created.target.id);
    expect(await enqueueDueCollectorJobs(db())).toBe(0);
    expect(
      await runCollectorOnce({
        sql: db(),
        provider: createMonitorProvider('offline'),
        config: fastConfig('future-idle'),
      }),
    ).toBe('idle');
    expect(await claimNextCollectorJob(db())).toBeNull();

    const runEarly = await app!.request(`/api/v1/monitor/targets/${created.target.id}/run`, {
      method: 'POST',
    });
    expect(runEarly.status).toBe(409);
    const earlyBody = (await runEarly.json()) as { code: string; error: string };
    expect(earlyBody.code).toBe('run_before_start');
    expect(earlyBody.error).toContain('开始时间');

    const dueAt = pastIso(1);
    const patched = await patchTarget(created.target.id, { startAt: dueAt });
    expect(patched.status).toBe(200);
    const after = parseMonitorTarget(((await patched.json()) as { target: unknown }).target);
    expect(after.startAt).toBe(dueAt);
    expect(after.nextRunAt).toBeTruthy();
    // Past plan keeps startAt; nextRunAt becomes "now" — not the same field.
    expect(after.nextRunAt).not.toBe(after.startAt);

    await parkExcept(created.target.id);
    const enqueued = await enqueueDueCollectorJobs(db());
    expect(enqueued + (await pendingCount(created.target.id))).toBeGreaterThan(0);
    expect(
      await runCollectorOnce({
        sql: db(),
        provider: createMonitorProvider('offline', { SOURCE_TIMEZONE: 'Asia/Shanghai' }),
        config: fastConfig('due-run'),
      }),
    ).toBe('succeeded');

    const listed = await app!.request('/api/v1/monitor/targets?pageSize=50');
    const row = ((await listed.json()) as { items: unknown[] }).items
      .map((item) => parseMonitorTarget(item))
      .find((item) => item.id === created.target.id);
    expect(row?.lastSuccessAt).toBeTruthy();
    expect(row?.startAt).toBe(dueAt);
    expect(row?.nextRunAt).toBeTruthy();
    expect(row?.nextRunAt).not.toBe(row?.startAt);

    const samples = await db()<{ n: number; sampled_at: Date }[]>`
      SELECT count(*)::int AS n, min(sampled_at) AS sampled_at
      FROM video_metric_samples WHERE bvid = 'BV1xx411c7mA'
    `;
    expect(samples[0]?.n).toBe(1);
  });

  test('reschedule postpone/advance/null/past; pause keeps paused; resume does not go early', async () => {
    const startAt = futureIso(8);
    const created = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'video',
          externalId: 'BV1xx411c7mB',
          startAt,
        })
      ).json(),
    );

    const later = futureIso(24);
    const postpone = await patchTarget(created.target.id, { startAt: later });
    expect(postpone.status).toBe(200);
    const postponed = parseMonitorTarget(((await postpone.json()) as { target: unknown }).target);
    expect(postponed.startAt).toBe(later);
    expect(await pendingCount(created.target.id)).toBe(0);

    const earlier = futureIso(3);
    const advance = await patchTarget(created.target.id, { startAt: earlier });
    expect(advance.status).toBe(200);
    expect(parseMonitorTarget(((await advance.json()) as { target: unknown }).target).startAt).toBe(
      earlier,
    );

    const paused = await patchTarget(created.target.id, { enabled: false });
    expect(paused.status).toBe(200);
    const whilePaused = await patchTarget(created.target.id, { startAt: futureIso(10) });
    expect(whilePaused.status).toBe(200);
    const pausedRow = parseMonitorTarget(
      ((await whilePaused.json()) as { target: unknown }).target,
    );
    expect(pausedRow.enabled).toBe(false);
    expect(pausedRow.startAt).toBeTruthy();
    expect(await pendingCount(created.target.id)).toBe(0);

    const resumed = await patchTarget(created.target.id, { enabled: true });
    expect(resumed.status).toBe(200);
    const resumedRow = parseMonitorTarget(((await resumed.json()) as { target: unknown }).target);
    expect(resumedRow.enabled).toBe(true);
    expect(resumedRow.startAt! > new Date().toISOString()).toBe(true);
    expect(await pendingCount(created.target.id)).toBe(0);
    await parkExcept(created.target.id);
    expect(
      await runCollectorOnce({
        sql: db(),
        provider: createMonitorProvider('offline'),
        config: fastConfig('resume-early'),
      }),
    ).toBe('idle');

    const clear = await patchTarget(created.target.id, { startAt: null });
    expect(clear.status).toBe(200);
    const cleared = parseMonitorTarget(((await clear.json()) as { target: unknown }).target);
    expect(cleared.startAt).toBeNull();
    expect(await pendingCount(created.target.id)).toBe(1);

    const past = await patchTarget(created.target.id, { startAt: pastIso(2) });
    // Already has no last_success yet but may have pending — still pending-start eligible.
    expect(past.status).toBe(200);
  });

  test('duplicate create does not overwrite plan; other videos unaffected; non-video rejected', async () => {
    const startAt = futureIso(12);
    const first = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'video',
          externalId: 'BV1xx411c7mC',
          label: '原计划',
          startAt,
        })
      ).json(),
    );
    const paused = await patchTarget(first.target.id, { enabled: false });
    expect(paused.status).toBe(200);

    const other = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'video',
          externalId: 'BV1xx411c7mH',
          startAt: futureIso(5),
        })
      ).json(),
    );
    expect(other.created).toBe(true);

    const dup = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'video',
          externalId: 'BV1xx411c7mC',
          label: '试图覆盖',
          startAt: futureIso(1),
        })
      ).json(),
    );
    expect(dup.created).toBe(false);
    expect(dup.target.id).toBe(first.target.id);
    expect(dup.target.label).toBe('原计划');
    expect(dup.target.enabled).toBe(false);
    expect(dup.target.startAt).toBe(startAt);

    const otherRead = await app!.request(`/api/v1/monitor/targets?pageSize=50`);
    const otherRow = ((await otherRead.json()) as { items: unknown[] }).items
      .map((item) => parseMonitorTarget(item))
      .find((item) => item.id === other.target.id);
    expect(otherRow?.startAt).toBe(other.target.startAt);

    const creator = await postTarget({
      type: 'creator',
      externalId: '17001',
      startAt: futureIso(2),
    });
    expect(creator.status).toBe(400);
    const creatorBody = (await creator.json()) as { code: string };
    expect(creatorBody.code).toBe('invalid_start_at');

    const dynamic = await postTarget({
      type: 'dynamic',
      externalId: '966692349750018099',
      startAt: '2026-10-21T20:00:00+08:00',
    });
    expect(dynamic.status).toBe(400);
    expect(((await dynamic.json()) as { code: string }).code).toBe('invalid_start_at');

    const noZone = await postTarget({
      type: 'video',
      externalId: 'BV1xx411c7aa',
      startAt: '2026-10-21T20:00:00',
    });
    expect(noZone.status).toBe(400);
    const noZoneBody = (await noZone.json()) as { code: string; error: string };
    expect(noZoneBody.code).toBe('invalid_start_at');
    expect(noZoneBody.error).toContain('时区');
  });

  test('running and last_success reject reschedule; failed-without-success allows; import samples do not block', async () => {
    await writeVideoSample(db(), {
      bvid: 'BV1xx411c7mJ',
      title: '导入样本',
      sampledAt: new Date('2020-01-01T00:00:00.000Z'),
      rawTime: '2020-01-01 08:00',
      sourceTimezone: 'Asia/Shanghai',
      timestampPrecision: 'minute',
      viewCount: 1n,
      onlineViewers: null,
      onlineViewersRaw: null,
      likeCount: null,
      coinCount: null,
      favoriteCount: null,
      shareCount: null,
      danmakuCount: null,
      commentCount: null,
      source: 'import',
    });

    const created = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'video',
          externalId: 'BV1xx411c7mJ',
          startAt: futureIso(4),
        })
      ).json(),
    );
    const okDespiteImport = await patchTarget(created.target.id, { startAt: futureIso(5) });
    expect(okDespiteImport.status).toBe(200);

    await patchTarget(created.target.id, { startAt: null });
    await parkExcept(created.target.id);
    expect(
      await runCollectorOnce({
        sql: db(),
        provider: createMonitorProvider('offline', { SOURCE_TIMEZONE: 'Asia/Shanghai' }),
        config: fastConfig('success-then-block'),
      }),
    ).toBe('succeeded');

    const blocked = await patchTarget(created.target.id, { startAt: futureIso(2) });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { code: string }).code).toBe('target_already_started');
    const listedAfter = (await (
      await app!.request('/api/v1/monitor/targets?pageSize=50')
    ).json()) as { items: unknown[] };
    const afterBlock = listedAfter.items
      .map((item) => parseMonitorTarget(item))
      .find((item) => item.id === created.target.id);
    expect(afterBlock?.startAt).toBeNull();

    const failTarget = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'video',
          externalId: 'BV1xx411c7mK',
          startAt: futureIso(2),
        })
      ).json(),
    );
    await db()`
      UPDATE monitor_targets
      SET last_error = '模拟失败', last_success_at = NULL, start_at = ${new Date(futureIso(2))}
      WHERE id = ${failTarget.target.id}::uuid
    `;
    const afterFail = await patchTarget(failTarget.target.id, { startAt: futureIso(6) });
    expect(afterFail.status).toBe(200);
    expect(
      parseMonitorTarget(((await afterFail.json()) as { target: unknown }).target).lastError,
    ).toBe('模拟失败');
  });

  test('true concurrency: reschedule vs claim cannot let old time run', async () => {
    const startAt = pastIso(1);
    const created = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'video',
          externalId: 'BV1xx411c7mL',
          startAt,
        })
      ).json(),
    );
    await parkExcept(created.target.id);
    if ((await pendingCount(created.target.id)) === 0) {
      await enqueueDueCollectorJobs(db());
    }
    expect(await pendingCount(created.target.id)).toBeGreaterThan(0);

    const cfg = readDbConfigFromEnv();
    const connA = createSql({ ...cfg, database: databaseName });
    try {
      const later = futureIso(48);
      const [claimResult, patchResult] = await Promise.all([
        claimNextCollectorJob(connA),
        patchTarget(created.target.id, { startAt: later }),
      ]);
      const patchBody = (await patchResult.json()) as {
        code?: string;
        target?: unknown;
        error?: string;
      };
      if (patchResult.status === 200) {
        const patched = parseMonitorTarget(patchBody.target);
        expect(patched.startAt).toBe(later);
        expect(claimResult).toBeNull();
      } else {
        expect(patchResult.status).toBe(409);
        expect(patchBody.code).toBe('target_running');
        expect(claimResult?.targetId).toBe(created.target.id);
        await db()`
          UPDATE collector_jobs
          SET status = 'failed', finished_at = statement_timestamp(), error = 'race-cleanup'
          WHERE id = ${claimResult!.id}::uuid AND status = 'running'
        `;
        const retry = await patchTarget(created.target.id, { startAt: later });
        expect(retry.status).toBe(200);
      }

      await parkExcept(created.target.id);
      expect(await claimNextCollectorJob(db())).toBeNull();
      expect(
        await runCollectorOnce({
          sql: db(),
          provider: createMonitorProvider('offline'),
          config: fastConfig('after-postpone'),
        }),
      ).toBe('idle');
    } finally {
      await connA.end({ timeout: 5 });
    }
  });

  test('running job rejects reschedule with zero side effects', async () => {
    const created = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'video',
          externalId: 'BV1xx411c7mP',
          startAt: futureIso(3),
        })
      ).json(),
    );
    const beforeStart = created.target.startAt;
    const jobId = crypto.randomUUID();
    await db()`
      INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for, started_at)
      VALUES (
        ${jobId}::uuid, ${created.target.id}::uuid, 'running', 1,
        statement_timestamp(), statement_timestamp()
      )
    `;
    const rejected = await patchTarget(created.target.id, { startAt: futureIso(9) });
    expect(rejected.status).toBe(409);
    expect(((await rejected.json()) as { code: string }).code).toBe('target_running');
    const [row] = await db()<{ start_at: Date | null }[]>`
      SELECT start_at FROM monitor_targets WHERE id = ${created.target.id}::uuid
    `;
    expect(row?.start_at?.toISOString() ?? null).toBe(beforeStart);
    const [job] = await db()<{ status: string }[]>`
      SELECT status FROM collector_jobs WHERE id = ${jobId}::uuid
    `;
    expect(job?.status).toBe('running');
  });

  test('ops records include create startAt and reschedule; omit does not invent', async () => {
    const startAt = futureIso(9);
    const created = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'video',
          externalId: 'BV1xx411c7mM',
          startAt,
        })
      ).json(),
    );
    const next = futureIso(11);
    const patched = await patchTarget(created.target.id, { startAt: next });
    expect(patched.status).toBe(200);
    const labelOnly = await patchTarget(created.target.id, { label: '仅改名' });
    expect(labelOnly.status).toBe(200);

    await apiLogger!.flush();
    const ops = parseOpsOperationList(
      await (
        await app!.request(`/api/v1/ops/operations?targetId=${created.target.id}&pageSize=50`)
      ).json(),
    );
    expect(ops.items.some((item) => item.action === 'create')).toBe(true);
    expect(ops.items.some((item) => item.action === 'reschedule')).toBe(true);
    const reschedule = ops.items.find((item) => item.action === 'reschedule');
    expect(reschedule?.changes.startAt?.after).toBe(next);
    expect(ops.items.some((item) => item.action === 'rename')).toBe(true);
  });

  test('cards expose startAt; omitted startAt on old payload parses as null', async () => {
    const startAt = futureIso(7);
    const created = parseMonitorTargetCreateResponse(
      await (
        await postTarget({
          type: 'video',
          externalId: 'BV1xx411c7mN',
          startAt,
        })
      ).json(),
    );
    const listed = await app!.request('/api/v1/monitor/cards?type=video&pageSize=50');
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      items: { externalId: string; target: { startAt: string | null } | null }[];
    };
    const hit = body.items.find((item) => item.externalId === 'BV1xx411c7mN');
    expect(hit?.target?.startAt).toBe(startAt);

    const legacy = parseMonitorTarget({
      id: created.target.id,
      type: 'video',
      externalId: 'BV1xx411c7mN',
      label: 'legacy',
      tags: [],
      enabled: true,
      intervalMinutes: 15,
      intervalMode: 'auto',
      nextRunAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      source: 'offline',
      createdAt: '2026-10-21T00:00:00.000Z',
      updatedAt: '2026-10-21T00:00:00.000Z',
      deletedAt: null,
    });
    expect(legacy.startAt).toBeNull();
  });

  test('video/creator/dynamic immediate create still works without startAt', async () => {
    const videoRes = await postTarget({ type: 'video', externalId: 'BV1xx411c7ab' });
    expect(videoRes.status).toBe(200);
    const video = parseMonitorTargetCreateResponse(await videoRes.json());
    expect(video.created).toBe(true);
    expect(video.target.startAt).toBeNull();
    expect(await pendingCount(video.target.id)).toBe(1);

    const creatorRes = await postTarget({ type: 'creator', externalId: '17002' });
    expect(creatorRes.status).toBe(200);
    const creator = parseMonitorTargetCreateResponse(await creatorRes.json());
    expect(creator.target.startAt).toBeNull();

    const dynamicRes = await postTarget({
      type: 'dynamic',
      externalId: '966692349750018100',
      intervalMode: 'fixed',
    });
    expect(dynamicRes.status).toBe(200);
    const dynamic = parseMonitorTargetCreateResponse(await dynamicRes.json());
    expect(dynamic.target.startAt).toBeNull();
    expect(dynamic.target.intervalMode).toBe('fixed');
  });
});
