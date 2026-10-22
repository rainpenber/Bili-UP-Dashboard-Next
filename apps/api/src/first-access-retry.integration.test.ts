import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { parseFirstAccessInterventionList } from '@studio/contracts';
import {
  createRetainedTestDatabase,
  enqueueDueCollectorJobs,
  insertMonitorTarget,
  recordCollectorFailure,
  requestCollectorRun,
  updateMonitorTarget,
  type Sql,
} from '@studio/db';
import {
  classifyBilibiliResponse,
  createBilibiliProvider,
  installOfflineFetchGuard,
  readBilibiliRuntimeConfig,
  readCollectorConfig,
  runCollectorOnce,
  type HttpTransport,
  type TransportRequest,
} from '@studio/monitoring';
import { createApp } from './app';
import { createMonitorRoutes } from './monitor-routes';

installOfflineFetchGuard();

const pubdate = Math.floor(Date.now() / 1000) - 3600;

function viewBody(bvid: string, code = 0) {
  return {
    code,
    message: code === 0 ? '0' : '啥都木有',
    data:
      code === 0
        ? {
            bvid,
            cid: 555,
            pubdate,
            title: '首次可访问',
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

function countingTransport(script: Map<string, number[]>): {
  transport: HttpTransport;
  viewHits: Map<string, number>;
} {
  const viewHits = new Map<string, number>();
  const transport: HttpTransport = async (request: TransportRequest) => {
    const url = new URL(request.url);
    const bvid = url.searchParams.get('bvid') ?? '';
    if (url.pathname.endsWith('/online/total')) {
      return {
        status: 200,
        body: JSON.stringify({ code: 0, data: { total: '12' } }),
        headers: {},
        durationMs: 1,
      };
    }
    const queue = script.get(bvid) ?? [0];
    const hit = viewHits.get(bvid) ?? 0;
    viewHits.set(bvid, hit + 1);
    const code = queue[Math.min(hit, queue.length - 1)] ?? 0;
    return {
      status: 200,
      body: JSON.stringify(viewBody(bvid, code)),
      headers: {},
      durationMs: 1,
    };
  };
  return { transport, viewHits };
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

/** Pull the pending retry forward without sleeping wall-clock five minutes. */
async function advancePendingToNow(sql: Sql, targetId: string): Promise<void> {
  await sql`
    UPDATE collector_jobs
    SET scheduled_for = statement_timestamp(), updated_at = statement_timestamp()
    WHERE target_id = ${targetId}::uuid AND status = 'pending'
  `;
  await sql`
    UPDATE monitor_targets
    SET next_run_at = statement_timestamp(), updated_at = statement_timestamp()
    WHERE id = ${targetId}::uuid
  `;
}

describe('WP-R2-17A2 first-access inaccessible retry', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_17a2');
    sql = isolated.sql;
    databaseName = isolated.databaseName;
  }, 60_000);

  afterAll(async () => {
    // Retained DB: close client only; do not DROP.
    await sql?.end({ timeout: 5 });
    if (databaseName) console.log(`retained first-access database: ${databaseName}`);
  });

  test('three -404 failures at +5min then manual intervention; no fourth auto request', async () => {
    if (!sql) return;
    const db = sql;
    const bvid = 'BV1xx411c7mA';
    const created = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: bvid,
      label: '未上线稿',
      tags: [],
      intervalMinutes: 15,
      now: new Date(),
    });
    await parkOtherPending(db, created.target.id);
    const { transport, viewHits } = countingTransport(new Map([[bvid, [-404]]]));
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
      ...readCollectorConfig({ COLLECTOR_INSTANCE_ID: 'fa-3fail' }),
      maxAttempts: 3,
    };
    const t0 = Date.now();

    expect(await runCollectorOnce({ sql: db, provider, config, now: new Date(t0) })).toBe('failed');
    const [after1] = await db<
      {
        status: string;
        attempts: number;
        scheduled_for: Date;
        next_run_at: Date | null;
        enabled: boolean;
        last_error: string | null;
      }[]
    >`
      SELECT j.status, j.attempts, j.scheduled_for, t.next_run_at, t.enabled, t.last_error
      FROM collector_jobs j
      JOIN monitor_targets t ON t.id = j.target_id
      WHERE j.target_id = ${created.target.id}::uuid
    `;
    expect(after1?.status).toBe('pending');
    expect(after1?.attempts).toBe(1);
    expect(after1?.enabled).toBe(true);
    expect(after1?.last_error ?? '').toContain('[first_access_waiting]');
    expect(after1?.last_error ?? '').toContain('失败 1/3 次');
    const gap1 = (after1!.scheduled_for.getTime() - t0) / 60_000;
    expect(gap1).toBeGreaterThanOrEqual(4.9);
    expect(gap1).toBeLessThanOrEqual(5.1);

    await advancePendingToNow(db, created.target.id);
    expect(
      await runCollectorOnce({ sql: db, provider, config, now: new Date(t0 + 5 * 60_000) }),
    ).toBe('failed');
    const [after2] = await db<{ status: string; attempts: number; last_error: string | null }[]>`
      SELECT j.status, j.attempts, t.last_error
      FROM collector_jobs j JOIN monitor_targets t ON t.id = j.target_id
      WHERE j.target_id = ${created.target.id}::uuid
    `;
    expect(after2?.status).toBe('pending');
    expect(after2?.attempts).toBe(2);
    expect(after2?.last_error ?? '').toContain('失败 2/3 次');

    await advancePendingToNow(db, created.target.id);
    expect(
      await runCollectorOnce({ sql: db, provider, config, now: new Date(t0 + 10 * 60_000) }),
    ).toBe('failed');
    const [after3] = await db<
      {
        status: string;
        attempts: number;
        enabled: boolean;
        next_run_at: Date | null;
        last_error: string | null;
      }[]
    >`
      SELECT j.status, j.attempts, t.enabled, t.next_run_at, t.last_error
      FROM collector_jobs j JOIN monitor_targets t ON t.id = j.target_id
      WHERE j.target_id = ${created.target.id}::uuid
    `;
    expect(after3?.status).toBe('failed');
    expect(after3?.attempts).toBe(3);
    expect(after3?.enabled).toBe(false);
    expect(after3?.next_run_at).toBeNull();
    expect(after3?.last_error ?? '').toContain('[first_access_awaiting_manual]');

    const [runs] = await db<{ count: string; samples: string }[]>`
      SELECT count(*)::text AS count,
        coalesce(sum(samples_written), 0)::text AS samples
      FROM collector_runs WHERE target_id = ${created.target.id}::uuid
    `;
    expect(runs?.count).toBe('3');
    expect(runs?.samples).toBe('0');
    expect(viewHits.get(bvid)).toBe(3);

    // Advance wall / restart worker / enqueue: no fourth automatic request while halted.
    expect(await enqueueDueCollectorJobs(db)).toBe(0);
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('idle');
    expect(viewHits.get(bvid)).toBe(3);

    const app = createApp({ skipDb: true });
    app.route('/api/v1/monitor', createMonitorRoutes(db));
    const listed1 = parseFirstAccessInterventionList(
      await (await app.request('/api/v1/monitor/first-access-interventions')).json(),
    );
    const item = listed1.items.find((row) => row.targetId === created.target.id);
    expect(item).toBeTruthy();
    expect(item?.status).toBe('awaiting_manual');
    expect(item?.bvid).toBe(bvid);
    expect(item?.failureCount).toBe(3);
    expect(item?.reason).toContain('[first_access_awaiting_manual]');
    const stableId = item!.id;

    const listed2 = parseFirstAccessInterventionList(
      await (await app.request('/api/v1/monitor/first-access-interventions')).json(),
    );
    expect(listed2.items.find((row) => row.targetId === created.target.id)?.id).toBe(stableId);

    // Bare enable while halted must refuse (no enabled=true without a pending round).
    const enableOnly = await app.request(`/api/v1/monitor/targets/${created.target.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enableOnly.status).toBe(409);
    const enableBody = (await enableOnly.json()) as { code: string; error: string };
    expect(enableBody.code).toBe('awaiting_manual_retry');
    expect(enableBody.error).toContain('手动采集');
    const [stillHalted] = await db<{ enabled: boolean }[]>`
      SELECT enabled FROM monitor_targets WHERE id = ${created.target.id}::uuid
    `;
    expect(stillHalted?.enabled).toBe(false);

    // Manual run starts a new bounded round; prior three failed runs remain.
    const manual = await requestCollectorRun(db, created.target.id, new Date());
    expect(manual.status).toBe('queued');
    if (manual.status !== 'queued') throw new Error('expected queued manual run');
    expect(manual.created).toBe(true);
    const newJobId = manual.job.id;
    expect(newJobId).not.toBe(stableId);
    const [enabled] = await db<{ enabled: boolean }[]>`
      SELECT enabled FROM monitor_targets WHERE id = ${created.target.id}::uuid
    `;
    expect(enabled?.enabled).toBe(true);

    await parkOtherPending(db, created.target.id);
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('failed');

    // Read API must surface the new waiting round, not the old awaiting_manual job.
    const afterManualList = parseFirstAccessInterventionList(
      await (await app.request('/api/v1/monitor/first-access-interventions')).json(),
    );
    const current = afterManualList.items.find((row) => row.targetId === created.target.id);
    expect(current?.id).toBe(newJobId);
    expect(current?.status).toBe('waiting_confirmation');
    expect(current?.failureCount).toBe(1);
    expect(current?.reason).toContain('[first_access_waiting]');

    const [runCount] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM collector_runs WHERE target_id = ${created.target.id}::uuid
    `;
    expect(Number(runCount?.count)).toBe(4);
    const [oldJob] = await db<{ status: string; attempts: number }[]>`
      SELECT status, attempts FROM collector_jobs WHERE id = ${stableId}::uuid
    `;
    expect(oldJob?.status).toBe('failed');
    expect(oldJob?.attempts).toBe(3);

    // Exhaust the new round → new job's awaiting_manual; history preserved; no 4th auto.
    await advancePendingToNow(db, created.target.id);
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('failed');
    await advancePendingToNow(db, created.target.id);
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('failed');
    const exhausted = parseFirstAccessInterventionList(
      await (await app.request('/api/v1/monitor/first-access-interventions')).json(),
    );
    const finalItem = exhausted.items.find((row) => row.targetId === created.target.id);
    expect(finalItem?.id).toBe(newJobId);
    expect(finalItem?.status).toBe('awaiting_manual');
    expect(finalItem?.failureCount).toBe(3);
    const [allRuns] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM collector_runs WHERE target_id = ${created.target.id}::uuid
    `;
    expect(Number(allRuns?.count)).toBe(6);
    expect(await enqueueDueCollectorJobs(db)).toBe(0);
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('idle');
    expect(viewHits.get(bvid)).toBe(6);
  });

  test('success on second first-access attempt enters the 15-minute tier', async () => {
    if (!sql) return;
    const db = sql;
    const bvid = 'BV1xx411c7mB';
    const created = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: bvid,
      label: '稍后可访问',
      tags: [],
      intervalMinutes: 60,
      intervalMode: 'auto',
      now: new Date(),
    });
    await parkOtherPending(db, created.target.id);
    const { transport, viewHits } = countingTransport(new Map([[bvid, [-404, 0]]]));
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
      ...readCollectorConfig({ COLLECTOR_INSTANCE_ID: 'fa-ok' }),
      maxAttempts: 3,
    };
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('failed');
    await advancePendingToNow(db, created.target.id);
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('succeeded');
    expect(viewHits.get(bvid)).toBe(2);
    const [cadence] = await db<{ minutes: number; seconds: number; last_success: Date | null }[]>`
      SELECT t.interval_minutes AS minutes,
        EXTRACT(EPOCH FROM (t.next_run_at - t.last_success_at))::int AS seconds,
        t.last_success_at AS last_success
      FROM monitor_targets t
      WHERE t.id = ${created.target.id}::uuid
    `;
    expect(cadence?.last_success).toBeInstanceOf(Date);
    expect(cadence?.minutes).toBe(15);
    expect(cadence?.seconds).toBe(15 * 60);
    const [samples] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM video_metric_samples WHERE bvid = ${bvid}
    `;
    expect(samples?.count).toBe('1');
  });

  test('future startAt stays zero-request until due; then first-access path applies', async () => {
    if (!sql) return;
    const db = sql;
    const bvid = 'BV1xx411c7mC';
    const startAt = new Date(Date.now() + 2 * 60 * 60_000);
    const created = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: bvid,
      label: '计划上线',
      tags: [],
      intervalMinutes: 15,
      startAt,
      now: new Date(),
    });
    const { transport, viewHits } = countingTransport(new Map([[bvid, [-404]]]));
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
      ...readCollectorConfig({ COLLECTOR_INSTANCE_ID: 'fa-start' }),
      maxAttempts: 3,
    };
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('idle');
    expect(viewHits.get(bvid) ?? 0).toBe(0);

    await db`
      UPDATE monitor_targets
      SET start_at = statement_timestamp() - interval '1 second',
          next_run_at = statement_timestamp() - interval '1 second'
      WHERE id = ${created.target.id}::uuid
    `;
    await parkOtherPending(db, created.target.id);
    expect(await runCollectorOnce({ sql: db, provider, config })).toBe('failed');
    expect(viewHits.get(bvid)).toBe(1);
    const [row] = await db<{ last_error: string | null; status: string }[]>`
      SELECT t.last_error, j.status
      FROM monitor_targets t
      JOIN collector_jobs j ON j.target_id = t.id
      WHERE t.id = ${created.target.id}::uuid
    `;
    expect(row?.status).toBe('pending');
    expect(row?.last_error ?? '').toContain('[first_access_waiting]');
  });

  test('risk / auth / network errors do not enter first-access wait', async () => {
    if (!sql) return;
    const db = sql;
    expect(classifyBilibiliResponse({ statusCode: 404, bizCode: -101, timedOut: false })).toBe(
      'unauthorized',
    );
    const cases: Array<{ bvid: string; code: number }> = [
      { bvid: 'BV1xx411c7mD', code: -352 },
      { bvid: 'BV1xx411c7mE', code: -509 },
      { bvid: 'BV1xx411c7mF', code: -101 },
    ];
    for (const row of cases) {
      const created = await insertMonitorTarget(db, {
        id: crypto.randomUUID(),
        type: 'video',
        externalId: row.bvid,
        label: `kind-${row.code}`,
        tags: [],
        intervalMinutes: 15,
        now: new Date(),
      });
      await parkOtherPending(db, created.target.id);
      const { transport } = countingTransport(new Map([[row.bvid, [row.code]]]));
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
        ...readCollectorConfig({ COLLECTOR_INSTANCE_ID: `fa-${row.code}` }),
        maxAttempts: 3,
      };
      const outcome = await runCollectorOnce({ sql: db, provider, config });
      expect(['failed', 'deferred']).toContain(outcome);
      const [target] = await db<{ last_error: string | null; enabled: boolean }[]>`
        SELECT last_error, enabled from monitor_targets WHERE id = ${created.target.id}::uuid
      `;
      expect(target?.last_error ?? '').not.toContain('first_access');
    }

    // HTTP 404 + biz -101 must expire/defer, not first-access wait.
    const authCombo = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: 'BV1xx411c7mG',
      label: '404-plus-101',
      tags: [],
      intervalMinutes: 15,
      now: new Date(),
    });
    await parkOtherPending(db, authCombo.target.id);
    const authTransport: HttpTransport = async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/online/total')) {
        return {
          status: 200,
          body: JSON.stringify({ code: 0, data: { total: '1' } }),
          headers: {},
          durationMs: 1,
        };
      }
      return {
        status: 404,
        body: JSON.stringify({ code: -101, message: '账号未登录' }),
        headers: {},
        durationMs: 1,
      };
    };
    const authProvider = createBilibiliProvider(
      {
        ...readBilibiliRuntimeConfig({}),
        minIntervalMs: 0,
        maxJitterMs: 0,
        anonymousMinIntervalMs: 0,
      },
      { transport: authTransport, random: () => 0 },
    );
    const authOutcome = await runCollectorOnce({
      sql: db,
      provider: authProvider,
      config: { ...readCollectorConfig({ COLLECTOR_INSTANCE_ID: 'fa-404-101' }), maxAttempts: 3 },
    });
    expect(['failed', 'deferred']).toContain(authOutcome);
    const [authTarget] = await db<{ last_error: string | null; enabled: boolean }[]>`
      SELECT last_error, enabled FROM monitor_targets WHERE id = ${authCombo.target.id}::uuid
    `;
    expect(authTarget?.last_error ?? '').not.toContain('first_access');
    expect(authTarget?.enabled).toBe(true);

    const creator = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'creator',
      externalId: '424242',
      label: 'UP',
      tags: [],
      intervalMinutes: 240,
      now: new Date(),
    });
    await parkOtherPending(db, creator.target.id);
    const app = createApp({ skipDb: true });
    app.route('/api/v1/monitor', createMonitorRoutes(db));
    const listed = parseFirstAccessInterventionList(
      await (await app.request('/api/v1/monitor/first-access-interventions')).json(),
    );
    expect(listed.items.every((item) => item.targetId !== creator.target.id)).toBe(true);
  });

  test('halt skips disable when a newer manual pending already exists', async () => {
    if (!sql) return;
    const db = sql;
    const created = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: 'BV1xx411c7mH',
      label: 'race-halt',
      tags: [],
      intervalMinutes: 15,
      now: new Date(),
    });
    const [seedJob] = await db<{ id: string }[]>`
      SELECT id::text AS id FROM collector_jobs WHERE target_id = ${created.target.id}::uuid LIMIT 1
    `;
    expect(seedJob?.id).toBeTruthy();
    const oldJobId = seedJob!.id;
    const now = new Date();
    await db`
      UPDATE collector_jobs
      SET status = 'running', attempts = 3, started_at = ${now}, error = NULL, updated_at = ${now}
      WHERE id = ${oldJobId}::uuid
    `;
    const newerPendingId = crypto.randomUUID();
    const newerAt = new Date(now.getTime() + 1000);
    await db`
      INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for)
      VALUES (
        ${newerPendingId}::uuid,
        ${created.target.id}::uuid,
        'pending',
        0,
        ${newerAt}
      )
    `;
    await db`
      UPDATE monitor_targets
      SET enabled = true, next_run_at = ${newerAt}, updated_at = ${now}
      WHERE id = ${created.target.id}::uuid
    `;

    const result = await recordCollectorFailure(db, {
      jobId: oldJobId,
      targetId: created.target.id,
      attempts: 3,
      maxAttempts: 3,
      error:
        'view 业务码 -404；首次采集上游确认暂不可访问，失败 3/3 次，达到上限待人工介入 [first_access_awaiting_manual]',
      durationMs: 1,
      startedAt: now,
      retryAt: null,
      haltAutoSchedule: true,
    });
    expect(result.applied).toBe(true);
    expect(result.halted).toBe(false);

    const [target] = await db<{ enabled: boolean; next_run_at: Date | null }[]>`
      SELECT enabled, next_run_at FROM monitor_targets WHERE id = ${created.target.id}::uuid
    `;
    expect(target?.enabled).toBe(true);
    expect(target?.next_run_at).not.toBeNull();
    const [newer] = await db<{ status: string }[]>`
      SELECT status FROM collector_jobs WHERE id = ${newerPendingId}::uuid
    `;
    expect(newer?.status).toBe('pending');
    const [old] = await db<{ status: string }[]>`
      SELECT status FROM collector_jobs WHERE id = ${oldJobId}::uuid
    `;
    expect(old?.status).toBe('failed');

    // Contrast: without a newer pending, halt disables.
    const alone = await insertMonitorTarget(db, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: 'BV1xx411c7mK',
      label: 'halt-alone',
      tags: [],
      intervalMinutes: 15,
      now: new Date(),
    });
    const [aloneJob] = await db<{ id: string }[]>`
      SELECT id::text AS id FROM collector_jobs WHERE target_id = ${alone.target.id}::uuid LIMIT 1
    `;
    await db`
      UPDATE collector_jobs
      SET status = 'running', attempts = 3, started_at = ${now}, updated_at = ${now}
      WHERE id = ${aloneJob!.id}::uuid
    `;
    const halted = await recordCollectorFailure(db, {
      jobId: aloneJob!.id,
      targetId: alone.target.id,
      attempts: 3,
      maxAttempts: 3,
      error:
        'view 业务码 -404；首次采集上游确认暂不可访问，失败 3/3 次，达到上限待人工介入 [first_access_awaiting_manual]',
      durationMs: 1,
      startedAt: now,
      retryAt: null,
      haltAutoSchedule: true,
    });
    expect(halted.halted).toBe(true);
    const [aloneTarget] = await db<{ enabled: boolean; next_run_at: Date | null }[]>`
      SELECT enabled, next_run_at FROM monitor_targets WHERE id = ${alone.target.id}::uuid
    `;
    expect(aloneTarget?.enabled).toBe(false);
    expect(aloneTarget?.next_run_at).toBeNull();

    const refused = await updateMonitorTarget(db, alone.target.id, { enabled: true }, new Date());
    expect(refused.status).toBe('awaiting_manual_retry');
    expect(refused.target?.enabled).toBe(false);
  });
});
