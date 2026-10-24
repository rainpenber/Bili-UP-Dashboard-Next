import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { parseMonitorCard, parseMonitorCardList } from '@studio/contracts';
import {
  claimNextCollectorJob,
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  enqueueDueCollectorJobs,
  recordCollectorSuccess,
  type Sql,
} from '@studio/db';
import { assertNoBilibiliNetwork, installOfflineFetchGuard } from '@studio/monitoring';
import { Hono } from 'hono';
import { createMonitorRoutes } from './monitor-routes';

const seenUrls: string[] = [];

describe('monitor card HTTP and pause claim', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let app: Hono | null = null;

  beforeAll(async () => {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seenUrls.push(url);
      return original(input, init);
    }) as typeof fetch;
    installOfflineFetchGuard();
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (!sql) return;
    app = new Hono();
    app.route('/api/v1/monitor', createMonitorRoutes(sql));
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  function http(): Hono {
    if (!app) throw new Error('app missing');
    return app;
  }

  function db(): Sql {
    if (!sql) throw new Error('postgres unavailable');
    return sql;
  }

  async function postTarget(body: Record<string, unknown>) {
    return http().request('/api/v1/monitor/targets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function patchTarget(id: string, body: Record<string, unknown>) {
    return http().request(`/api/v1/monitor/targets/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  test('create, pause, reload, and resume round trip for video and creator', async () => {
    if (!sql || !app) return;
    for (const input of [
      { type: 'video', externalId: 'BV1round1111', label: '闭环视频' },
      { type: 'creator', externalId: '810010', label: '闭环UP' },
    ]) {
      const created = await postTarget({ ...input, intervalMode: 'auto' });
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as { created: boolean; target: { id: string } };
      expect(createdBody.created).toBe(true);
      const listed = parseMonitorCardList(
        await (
          await http().request(
            `/api/v1/monitor/cards?type=${input.type}&q=${input.externalId}&page=1&pageSize=8`,
          )
        ).json(),
      );
      expect(listed.totalItems).toBe(1);
      expect(listed.items[0]?.hasEntity).toBe(false);
      expect(listed.items[0]?.hasSamples).toBe(false);
      expect(listed.items[0]?.monitorState).toBe('active');
      expect(listed.items[0]?.displayName).toBe(input.label);
      expect(JSON.stringify(listed.items[0])).not.toContain('monitoringEnabled');

      const paused = await patchTarget(createdBody.target.id, { enabled: false });
      expect(paused.status).toBe(200);
      const pausedCard = parseMonitorCard(
        await (
          await http().request(`/api/v1/monitor/cards/${input.type}/${input.externalId}`)
        ).json(),
      );
      expect(pausedCard.monitorState).toBe('paused');
      expect(pausedCard.target?.enabled).toBe(false);

      const resumed = await patchTarget(createdBody.target.id, { enabled: true });
      expect(resumed.status).toBe(200);
      const resumedCard = parseMonitorCard(
        await (
          await http().request(`/api/v1/monitor/cards/${input.type}/${input.externalId}`)
        ).json(),
      );
      expect(resumedCard.monitorState).toBe('active');
      expect(resumedCard.target?.intervalMode).toBe('auto');
    }
  });

  test('concurrent create is idempotent and does not resume a paused target', async () => {
    if (!sql || !app) return;
    const body = { type: 'video', externalId: 'BV1idemp1111', intervalMode: 'auto', label: '幂等' };
    const [first, second] = await Promise.all([postTarget(body), postTarget(body)]);
    const firstBody = (await first.json()) as {
      created: boolean;
      target: { id: string; enabled: boolean };
    };
    const secondBody = (await second.json()) as {
      created: boolean;
      target: { id: string; enabled: boolean };
    };
    expect([firstBody.created, secondBody.created].filter(Boolean)).toHaveLength(1);
    expect(firstBody.target.id).toBe(secondBody.target.id);
    await patchTarget(firstBody.target.id, { enabled: false });
    const [again, another] = await Promise.all([postTarget(body), postTarget(body)]);
    const againBody = (await again.json()) as { created: boolean; target: { enabled: boolean } };
    const anotherBody = (await another.json()) as {
      created: boolean;
      target: { enabled: boolean };
    };
    expect(againBody.created).toBe(false);
    expect(anotherBody.created).toBe(false);
    expect(againBody.target.enabled).toBe(false);
    expect(anotherBody.target.enabled).toBe(false);
  });

  test('a claimed round can finish after pause, and resume does not backfill', async () => {
    if (!sql || !app) return;
    const created = await postTarget({
      type: 'video',
      externalId: 'BV1taken1111',
      intervalMode: 'fixed',
      intervalMinutes: 15,
    });
    const createdBody = (await created.json()) as { target: { id: string } };
    const targetId = createdBody.target.id;
    await db()`
      UPDATE monitor_targets
      SET enabled = false
      WHERE id <> ${targetId}::uuid
    `;
    await db()`
      UPDATE collector_jobs
      SET scheduled_for = statement_timestamp() + interval '7 days'
      WHERE target_id <> ${targetId}::uuid AND status = 'pending'
    `;
    await db()`
      INSERT INTO videos (bvid, title, monitoring_enabled)
      VALUES ('BV1taken1111', '已领取', true)
    `;
    await db()`
      INSERT INTO video_metric_samples (
        bvid, sampled_at, source_timezone, raw_time, timestamp_precision, view_count
      ) VALUES (
        'BV1taken1111', now(), 'Asia/Shanghai', '2026-03-01 08:00', 'minute', 7
      )
    `;
    const claimed = await claimNextCollectorJob(db());
    expect(claimed?.targetId).toBe(targetId);
    expect(claimed?.id).toBeTruthy();
    const paused = await patchTarget(targetId, { enabled: false });
    expect(paused.status).toBe(200);
    const running = await db()<{ status: string }[]>`
      SELECT status FROM collector_jobs WHERE id = ${claimed!.id}::uuid
    `;
    expect(running[0]?.status).toBe('running');
    expect(await claimNextCollectorJob(db())).toBeNull();
    const queuedWhilePaused = await db()<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM collector_jobs
      WHERE target_id = ${targetId}::uuid AND status IN ('pending', 'running')
    `;
    await enqueueDueCollectorJobs(db());
    const queuedAfterEnqueue = await db()<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM collector_jobs
      WHERE target_id = ${targetId}::uuid AND status IN ('pending', 'running')
    `;
    expect(queuedAfterEnqueue[0]?.count).toBe(queuedWhilePaused[0]?.count);
    await recordCollectorSuccess(db(), {
      jobId: claimed!.id,
      targetId,
      samplesWritten: 0,
      durationMs: 5,
      startedAt: new Date(),
      schedule: { minutes: 15, persistMinutes: false },
    });
    const finished = await db()<{ status: string; enabled: boolean; samples: string }[]>`
      SELECT j.status, t.enabled, (
        SELECT count(*)::text FROM video_metric_samples WHERE bvid = 'BV1taken1111'
      ) AS samples
      FROM collector_jobs j
      JOIN monitor_targets t ON t.id = j.target_id
      WHERE j.id = ${claimed!.id}::uuid
    `;
    expect(finished[0]?.status).toBe('succeeded');
    expect(finished[0]?.enabled).toBe(false);
    expect(finished[0]?.samples).toBe('1');
    await db()`
      UPDATE monitor_targets
      SET next_run_at = statement_timestamp() - interval '30 days'
      WHERE id = ${targetId}::uuid
    `;
    const beforePauseEnqueue = await db()<{ count: string }[]>`
      SELECT count(*)::text AS count FROM collector_jobs WHERE target_id = ${targetId}::uuid
    `;
    await enqueueDueCollectorJobs(db());
    const afterPauseEnqueue = await db()<{ count: string }[]>`
      SELECT count(*)::text AS count FROM collector_jobs WHERE target_id = ${targetId}::uuid
    `;
    expect(afterPauseEnqueue[0]?.count).toBe(beforePauseEnqueue[0]?.count);
    const before = await db()<{ count: string }[]>`
      SELECT count(*)::text AS count FROM collector_jobs WHERE target_id = ${targetId}::uuid
    `;
    const resumed = await patchTarget(targetId, { enabled: true });
    expect(resumed.status).toBe(200);
    const after = await db()<{ count: string; pending: string }[]>`
      SELECT count(*)::text AS count,
        count(*) FILTER (WHERE status = 'pending')::text AS pending
      FROM collector_jobs
      WHERE target_id = ${targetId}::uuid
    `;
    expect(Number(after[0]?.count)).toBe(Number(before[0]?.count) + 1);
    expect(after[0]?.pending).toBe('1');
    await enqueueDueCollectorJobs(db());
    const afterEnqueue = await db()<{ pending: string }[]>`
      SELECT count(*) FILTER (WHERE status = 'pending')::text AS pending
      FROM collector_jobs
      WHERE target_id = ${targetId}::uuid
    `;
    expect(afterEnqueue[0]?.pending).toBe('1');
    const schedule = await db()<{ next_run_at: Date }[]>`
      SELECT next_run_at FROM monitor_targets WHERE id = ${targetId}::uuid
    `;
    const nextRun = schedule[0]?.next_run_at?.getTime() ?? 0;
    expect(Math.abs(nextRun - Date.now())).toBeLessThan(60_000);
    expect(seenUrls.some((url) => /bilibili/i.test(url))).toBe(false);
    expect(() => assertNoBilibiliNetwork('https://api.bilibili.com/x/web-interface/view')).toThrow(
      /Blocked network/,
    );
  });
});
