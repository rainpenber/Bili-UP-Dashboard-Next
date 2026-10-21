import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import {
  opsDefaultRange,
  parseOpsCollectorJobDetail,
  parseOpsCollectorJobGroups,
  parseOpsCollectorJobList,
} from '@studio/contracts';
import { createRetainedTestDatabase, type Sql } from '@studio/db';
import { createOpsRoutes } from './ops-routes';

const DAY = '2026-10-21';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const C = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const D = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const E = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const F = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
const P1 = '12121212-1212-4121-8121-121212121211';
const P2 = '12121212-1212-4121-8121-121212121212';
const P3 = '12121212-1212-4121-8121-121212121213';
const PENDING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const RUNNING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const FAILED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const SUCCESS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const REQUEUE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
const DELETED_RECENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6';
const DELETED_OLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7';
const OUTSIDE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8';
const BOUND_IN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9';
const BOUND_BEFORE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb10';
const BOUND_AFTER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11';
const RUN_FAIL = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const RUN_FIRST = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const RUN_OK = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const RUN_RETRY = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4';
const RUN_RECENT = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5';
const RUN_OLD = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc6';

const pageJobIds = Array.from({ length: 21 }, (_, index) => {
  const suffix = index.toString(16).padStart(12, '0');
  return `dddddddd-dddd-4ddd-8ddd-${suffix}`;
});

describe('ops collection records on an isolated database', () => {
  let sql: Sql | null = null;
  let app: Hono | null = null;

  beforeAll(async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_14');
    sql = isolated.sql;
    app = new Hono();
    app.onError(() => new Response(JSON.stringify({ error: 'internal' }), { status: 500 }));
    app.route('/api/v1/ops', createOpsRoutes(sql));
    await seed(sql);
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  async function get(path: string): Promise<unknown> {
    if (!app) throw new Error('app missing');
    const response = await app.request(path);
    const body = (await response.json()) as unknown;
    if (response.status !== 200) {
      throw new Error(`${response.status} ${path} ${JSON.stringify(body)}`);
    }
    return body;
  }

  test('fails closed when the database rejects the read', async () => {
    const broken = new Hono();
    broken.onError(() => new Response(JSON.stringify({ error: 'internal' }), { status: 500 }));
    const db = (async () => {
      throw new Error('db down');
    }) as unknown as Sql;
    broken.route('/api/v1/ops', createOpsRoutes(db));
    const response = await broken.request('/api/v1/ops/collector-jobs');
    expect(response.status).toBe(500);
    const body = (await response.json()) as { items?: unknown };
    expect(body.items).toBeUndefined();
  });

  test('projects real job states, shanghai boundaries, paging, and groups', async () => {
    const day = `since=${DAY}&until=${DAY}`;
    const listed = parseOpsCollectorJobList(
      await get(`/api/v1/ops/collector-jobs?${day}&pageSize=50`),
    );
    const byId = new Map(listed.items.map((item) => [item.id, item]));

    const pending = byId.get(PENDING);
    expect(pending?.status).toBe('pending');
    expect(pending?.attempts).toBe(0);
    expect(pending?.durationMs).toBeNull();
    expect(pending?.samplesWritten).toBeNull();
    expect(pending?.latestAttempt).toBeNull();
    expect(pending?.startedAt).toBeNull();

    const running = byId.get(RUNNING);
    expect(running?.status).toBe('running');
    expect(running?.samplesWritten).toBeNull();
    expect(running?.durationMs).not.toBeNull();
    expect(running?.latestAttempt).toBeNull();

    const failed = byId.get(FAILED);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('upstream timeout');
    expect(failed?.samplesWritten).toBe(0);
    expect(failed?.latestAttempt?.id).toBe(RUN_FAIL);

    const success = byId.get(SUCCESS);
    expect(success?.status).toBe('succeeded');
    expect(success?.samplesWritten).toBe(7);
    expect(success?.attempts).toBe(2);
    expect(success?.latestAttempt?.id).toBe(RUN_OK);
    expect(success?.latestAttempt?.status).toBe('succeeded');

    const requeued = byId.get(REQUEUE);
    expect(requeued?.status).toBe('pending');
    expect(requeued?.durationMs).toBeNull();
    expect(requeued?.samplesWritten).toBeNull();
    expect(requeued?.latestAttempt?.status).toBe('failed');
    expect(requeued?.latestAttempt?.error).toBe('first try failed');
    expect(listed.items.filter((item) => item.id === REQUEUE)).toHaveLength(1);

    const removed = byId.get(DELETED_RECENT);
    expect(removed?.targetDeleted).toBe(true);
    expect(removed?.status).toBe('succeeded');
    expect(removed?.displayName).toBe('已删稿');
    expect(removed?.samplesWritten).toBe(3);

    expect(byId.has(OUTSIDE)).toBe(false);
    expect(byId.has(BOUND_BEFORE)).toBe(false);
    expect(byId.has(BOUND_AFTER)).toBe(false);
    expect(byId.get(BOUND_IN)?.scheduledFor).toBe('2026-10-20T16:00:00.000Z');

    const names = parseOpsCollectorJobList(
      await get(
        `/api/v1/ops/collector-jobs?${day}&q=${encodeURIComponent('同名稿件')}&pageSize=50`,
      ),
    );
    expect([...new Set(names.items.map((item) => item.targetId))].sort()).toEqual([A, B].sort());

    const onlyA = parseOpsCollectorJobList(
      await get(`/api/v1/ops/collector-jobs?${day}&targetId=${A}&pageSize=50`),
    );
    expect(onlyA.items.every((item) => item.targetId === A)).toBe(true);
    expect(onlyA.items.some((item) => item.id === PENDING)).toBe(true);
    expect(onlyA.items.some((item) => item.id === SUCCESS)).toBe(false);

    const card = parseOpsCollectorJobList(
      await get(
        `/api/v1/ops/collector-jobs?${day}&targetId=${A}&targetType=video&externalId=BV1xx411c7mD&type=video&pageSize=50`,
      ),
    );
    expect(card.items.map((item) => item.id).sort()).toEqual(
      onlyA.items.map((item) => item.id).sort(),
    );

    const creators = parseOpsCollectorJobList(
      await get(`/api/v1/ops/collector-jobs?${day}&type=creator&pageSize=50`),
    );
    expect(creators.items.map((item) => item.id).sort()).toEqual([REQUEUE, RUNNING].sort());

    const projectA = parseOpsCollectorJobList(
      await get(`/api/v1/ops/collector-jobs?${day}&projectId=${P1}&pageSize=50`),
    );
    expect(projectA.items.every((item) => item.targetId === A)).toBe(true);
    expect(projectA.items.some((item) => item.id === PENDING)).toBe(true);
    const projectB = parseOpsCollectorJobList(
      await get(`/api/v1/ops/collector-jobs?${day}&projectId=${P2}&pageSize=50`),
    );
    expect(projectB.items.map((item) => item.id).sort()).toEqual(
      projectA.items.map((item) => item.id).sort(),
    );
    const projectC = parseOpsCollectorJobList(
      await get(`/api/v1/ops/collector-jobs?${day}&projectId=${P3}&pageSize=50`),
    );
    expect(projectC.total).toBe(0);

    const firstPage = parseOpsCollectorJobList(
      await get(`/api/v1/ops/collector-jobs?${day}&targetId=${E}&page=1&pageSize=20`),
    );
    const secondPage = parseOpsCollectorJobList(
      await get(`/api/v1/ops/collector-jobs?${day}&targetId=${E}&page=2&pageSize=20`),
    );
    expect(firstPage.total).toBe(21);
    expect(firstPage.items).toHaveLength(20);
    expect(secondPage.items).toHaveLength(1);
    const paged = [...firstPage.items, ...secondPage.items].map((item) => item.id);
    expect(new Set(paged).size).toBe(21);
    expect(paged.sort()).toEqual([...pageJobIds].sort());

    const grouped = parseOpsCollectorJobGroups(
      await get(`/api/v1/ops/collector-jobs?${day}&targetId=${E}&group=target&jobsPerGroup=5`),
    );
    expect(grouped.total).toBe(1);
    expect(grouped.items[0]?.matchCount).toBe(21);
    expect(grouped.items[0]?.jobs).toHaveLength(5);
    expect(grouped.items[0]?.truncated).toBe(true);
    const newest = [...pageJobIds].reverse();
    expect(grouped.items[0]?.jobs.map((item) => item.id)).toEqual(newest.slice(0, 5));

    const defaults = parseOpsCollectorJobList(await get('/api/v1/ops/collector-jobs?pageSize=50'));
    expect(defaults.range.defaulted).toBe(true);
    expect(defaults.range.timezone).toBe('Asia/Shanghai');
    expect(defaults.range).toMatchObject(opsDefaultRange());
    expect(defaults.items.some((item) => item.id === OUTSIDE)).toBe(false);
    expect(JSON.stringify(defaults)).not.toContain('plain-sess-value-9f3a');
  });

  test('job detail binds attempts, requests, and logs to that job only', async () => {
    const detail = parseOpsCollectorJobDetail(await get(`/api/v1/ops/collector-jobs/${SUCCESS}`));
    expect(detail.job.status).toBe('succeeded');
    expect(detail.job.samplesWritten).toBe(7);
    expect(detail.attempts.map((attempt) => attempt.id)).toEqual([RUN_OK, RUN_FIRST]);
    const ok = detail.attempts[0];
    const first = detail.attempts[1];
    expect(ok?.requests.map((request) => request.endpoint)).toEqual(['view-ok']);
    expect(ok?.requests.every((request) => request.runId === RUN_OK)).toBe(true);
    expect(ok?.logs.map((entry) => entry.message)).toEqual(['wrote samples']);
    expect(ok?.logNote).toBeNull();
    expect(first?.requests.map((request) => request.endpoint)).toEqual(['view-fail']);
    expect(first?.logs.map((entry) => entry.runId)).toEqual([RUN_FIRST]);
    expect(first?.logs.map((entry) => entry.message)).toEqual(['[redacted]']);
    expect(first?.logNote).toBeNull();
    expect(JSON.stringify(detail)).not.toContain('other-job');
    expect(JSON.stringify(detail)).not.toContain('plain-sess-value-9f3a');

    const recent = parseOpsCollectorJobDetail(
      await get(`/api/v1/ops/collector-jobs/${DELETED_RECENT}`),
    );
    expect(recent.job.status).toBe('succeeded');
    expect(recent.attempts[0]?.logNote).toBe('暂无关联日志');
    expect(recent.attempts[0]?.status).toBe('succeeded');

    const old = parseOpsCollectorJobDetail(await get(`/api/v1/ops/collector-jobs/${DELETED_OLD}`));
    expect(old.job.status).toBe('succeeded');
    expect(old.attempts[0]?.logNote).toBe('关联日志已过保留期');
    expect(old.attempts[0]?.samplesWritten).toBe(2);

    const pending = parseOpsCollectorJobDetail(await get(`/api/v1/ops/collector-jobs/${PENDING}`));
    expect(pending.attemptTotal).toBe(0);
    expect(pending.attempts).toEqual([]);
    expect(pending.job.durationMs).toBeNull();

    if (!app) throw new Error('app missing');
    expect((await app.request('/api/v1/ops/collector-jobs/not-a-uuid')).status).toBe(400);
    expect(
      (await app.request('/api/v1/ops/collector-jobs/00000000-0000-4000-8000-000000000099')).status,
    ).toBe(404);
    expect((await app.request('/api/v1/ops/collector-jobs?status=queued')).status).toBe(400);
  });
});

async function seed(sql: Sql): Promise<void> {
  await sql`
    INSERT INTO videos (bvid, title, cover_url) VALUES
      ('BV1xx411c7mD', '同名稿件', 'https://example.test/a.jpg'),
      ('BV1xx411c7mE', '同名稿件', 'https://example.test/b.jpg'),
      ('BV1xx411c7mF', '已删稿', NULL),
      ('BV1xx411c7mG', '翻页稿', NULL),
      ('BV1xx411c7mH', '边界稿', NULL)
  `;
  await sql`
    INSERT INTO creators (mid, uname) VALUES (42, '作者甲')
  `;
  await sql`
    INSERT INTO monitor_targets (id, type, external_id, label, interval_minutes, source, deleted_at)
    VALUES
      (${A}::uuid, 'video', 'BV1xx411c7mD', '同名', 60, 'offline', NULL),
      (${B}::uuid, 'video', 'BV1xx411c7mE', '同名', 60, 'offline', NULL),
      (${C}::uuid, 'creator', '42', '作者甲', 60, 'offline', NULL),
      (${D}::uuid, 'video', 'BV1xx411c7mF', '已删稿', 60, 'offline', statement_timestamp()),
      (${E}::uuid, 'video', 'BV1xx411c7mG', '翻页稿', 60, 'offline', NULL),
      (${F}::uuid, 'video', 'BV1xx411c7mH', '边界稿', 60, 'offline', NULL)
  `;
  await sql`
    INSERT INTO commercial_projects (id, name) VALUES
      (${P1}::uuid, '商单甲'),
      (${P2}::uuid, '商单乙'),
      (${P3}::uuid, '商单丙')
  `;
  await sql`
    INSERT INTO project_publish_records (project_id, bvid, published_at, idempotency_key)
    VALUES (${P1}::uuid, 'BV1xx411c7mD', '2026-10-01T00:00:00Z', 'wp-r2-14-p1')
  `;
  await sql`
    INSERT INTO project_monitor_contracts (id, project_id, bvid)
    VALUES (${P2}::uuid, ${P2}::uuid, 'BV1xx411c7mD')
  `;
  await sql`
    INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for, started_at, finished_at, error)
    VALUES
      (${PENDING}::uuid, ${A}::uuid, 'pending', 0, '2026-10-21T02:00:00Z', NULL, NULL, NULL),
      (${RUNNING}::uuid, ${C}::uuid, 'running', 1, '2026-10-21T03:00:00Z', statement_timestamp() - interval '5 seconds', NULL, NULL),
      (${FAILED}::uuid, ${A}::uuid, 'failed', 1, '2026-10-21T04:00:00Z', '2026-10-21T04:00:01Z', '2026-10-21T04:00:02Z', 'upstream timeout'),
      (${SUCCESS}::uuid, ${B}::uuid, 'succeeded', 2, '2026-10-21T05:00:00Z', '2026-10-21T05:00:01Z', '2026-10-21T05:00:03Z', NULL),
      (${REQUEUE}::uuid, ${C}::uuid, 'pending', 1, '2026-10-21T06:00:00Z', NULL, NULL, NULL),
      (${DELETED_RECENT}::uuid, ${D}::uuid, 'succeeded', 1, '2026-10-21T07:00:00Z', '2026-10-21T07:00:01Z', '2026-10-21T07:00:02Z', NULL),
      (${DELETED_OLD}::uuid, ${D}::uuid, 'succeeded', 1, '2026-10-21T08:00:00Z', statement_timestamp() - interval '40 days', statement_timestamp() - interval '40 days', NULL),
      (${OUTSIDE}::uuid, ${A}::uuid, 'pending', 0, '2020-01-01T02:00:00Z', NULL, NULL, NULL),
      (${BOUND_IN}::uuid, ${F}::uuid, 'pending', 0, '2026-10-20T16:00:00Z', NULL, NULL, NULL),
      (${BOUND_BEFORE}::uuid, ${F}::uuid, 'pending', 0, '2026-10-20T15:59:59Z', NULL, NULL, NULL),
      (${BOUND_AFTER}::uuid, ${F}::uuid, 'pending', 0, '2026-10-21T16:00:00Z', NULL, NULL, NULL)
  `;
  for (const [index, id] of pageJobIds.entries()) {
    await sql`
      INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for)
      VALUES (
        ${id}::uuid,
        ${E}::uuid,
        'pending',
        0,
        ${new Date(Date.parse('2026-10-21T00:30:00Z') + index * 60_000)}
      )
    `;
  }
  await sql`
    INSERT INTO collector_runs (
      id, job_id, target_id, status, samples_written, duration_ms, error, started_at, finished_at
    ) VALUES
      (${RUN_FAIL}::uuid, ${FAILED}::uuid, ${A}::uuid, 'failed', 0, 40, 'upstream timeout', '2026-10-21T04:00:01Z', '2026-10-21T04:00:02Z'),
      (${RUN_FIRST}::uuid, ${SUCCESS}::uuid, ${B}::uuid, 'failed', 0, 20, 'first attempt', '2026-10-21T05:00:01Z', '2026-10-21T05:00:02Z'),
      (${RUN_OK}::uuid, ${SUCCESS}::uuid, ${B}::uuid, 'succeeded', 7, 80, NULL, '2026-10-21T05:00:02Z', '2026-10-21T05:00:03Z'),
      (${RUN_RETRY}::uuid, ${REQUEUE}::uuid, ${C}::uuid, 'failed', 1, 15, 'first try failed', '2026-10-21T05:30:00Z', '2026-10-21T05:30:01Z'),
      (${RUN_RECENT}::uuid, ${DELETED_RECENT}::uuid, ${D}::uuid, 'succeeded', 3, 12, NULL, statement_timestamp(), statement_timestamp()),
      (${RUN_OLD}::uuid, ${DELETED_OLD}::uuid, ${D}::uuid, 'succeeded', 2, 9, NULL, '2000-01-01T00:00:00Z', '2000-01-01T00:00:01Z')
  `;
  await sql`
    INSERT INTO collector_requests (run_id, endpoint, status_code, biz_code, duration_ms, error, requested_at)
    VALUES
      (${RUN_OK}::uuid, 'view-ok', 200, 0, 11, NULL, '2026-10-21T05:00:02Z'),
      (${RUN_FIRST}::uuid, 'view-fail', 500, NULL, 9, 'first attempt', '2026-10-21T05:00:01Z'),
      (${RUN_FAIL}::uuid, 'view-other', 500, NULL, 8, 'other-job', '2026-10-21T04:00:01Z')
  `;
  await sql`
    INSERT INTO app_logs (level, service, event, message, run_id, job_id, target_id, context)
    VALUES
      ('info', 'collector', 'job.succeeded', 'wrote samples', ${RUN_OK}::uuid, ${SUCCESS}::uuid, ${B}::uuid, '{"note":"ok"}'::jsonb),
      ('error', 'collector', 'job.failed', 'SESSDATA=plain-sess-value-9f3a', ${RUN_FIRST}::uuid, ${SUCCESS}::uuid, ${B}::uuid, '{"password":"pw-secret"}'::jsonb),
      ('error', 'collector', 'job.failed', 'other-job', ${RUN_FAIL}::uuid, ${FAILED}::uuid, ${A}::uuid, '{}'::jsonb)
  `;
}
