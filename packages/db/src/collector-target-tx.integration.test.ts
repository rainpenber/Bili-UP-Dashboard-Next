import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSql, type Sql } from './client';
import { readDbConfigFromEnv } from './config';
import {
  SUPERSEDED_ACTIVE_JOB_ERROR,
  convergeActiveJobsUnderTargetLock,
  withMonitorTargetTransaction,
} from './collector-target-tx';
import {
  claimNextCollectorJob,
  enqueueDueCollectorJobs,
  getCollectorJob,
  getMonitorTarget,
  insertMonitorTarget,
  recordCollectorFailure,
  recordCollectorSuccess,
  requestCollectorRun,
  softDeleteMonitorTarget,
  updateMonitorTarget,
} from './monitor-targets';
import {
  commitBilibiliCreator,
  commitBilibiliDynamic,
  commitBilibiliVideo,
  deferCollectorJob,
} from './real-collector';
import { createRetainedTestDatabase } from './test-isolated-db';

const RETAINED_PREFIX = 'wp_r2_17r0';

describe('WP-R2-17R0 collector target transaction foundation', () => {
  let sql: Sql;
  let databaseName: string;
  let bvSeq = 0;
  let midSeq = 350_000_170;
  let dynSeq = 850_000_000_000_170n;

  beforeAll(async () => {
    const isolated = await createRetainedTestDatabase(RETAINED_PREFIX);
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    console.log(`RETAINED_DB ${databaseName}`);
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  function nextBvid(): string {
    bvSeq += 1;
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let n = bvSeq;
    let suffix = '';
    for (let i = 0; i < 10; i += 1) {
      suffix = alphabet[n % alphabet.length]! + suffix;
      n = Math.floor(n / alphabet.length) + 1;
    }
    return `BV${suffix}`;
  }

  function extraConn(): Sql {
    const cfg = readDbConfigFromEnv();
    return createSql({ ...cfg, database: databaseName });
  }

  async function waitUntil(predicate: () => Promise<boolean>, label: string): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
      if (await predicate()) return;
      await Bun.sleep(10);
    }
    throw new Error(`${label} 超时`);
  }

  async function countUngrantedLocks(watch: Sql): Promise<number> {
    const rows = await watch<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.granted = false
        AND a.datname = current_database()
    `;
    return rows[0]?.n ?? 0;
  }

  async function seedRunningJob(input: {
    type: 'video' | 'creator' | 'dynamic';
    externalId: string;
    intervalMinutes?: number;
  }): Promise<{ targetId: string; jobId: string; scheduledFor: Date }> {
    const now = new Date('2026-10-21T12:00:00.000Z');
    const created = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: input.type,
      externalId: input.externalId,
      label: input.externalId,
      tags: [],
      intervalMinutes: input.intervalMinutes ?? 60,
      intervalMode: input.type === 'dynamic' ? 'fixed' : 'auto',
      now,
    });
    expect(created.created).toBe(true);
    expect(created.jobId).toBeTruthy();
    const claimed = await sql<{ id: string; scheduled_for: Date }[]>`
      UPDATE collector_jobs
      SET status = 'running', started_at = ${now}, attempts = 1, updated_at = ${now}
      WHERE id = ${created.jobId!}::uuid
      RETURNING id::text AS id, scheduled_for
    `;
    return {
      targetId: created.target.id,
      jobId: claimed[0]!.id,
      scheduledFor: claimed[0]!.scheduled_for,
    };
  }

  test('commitBilibiliVideo waits on target-lock barrier without 40P01', async () => {
    const seeded = await seedRunningJob({ type: 'video', externalId: nextBvid() });
    const connA = extraConn();
    const connB = extraConn();
    const watch = extraConn();
    try {
      let release = (): void => undefined;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked = false;
      // Simulate future 17R1 target edit: hold common target lock seam (no startAt).
      const hold = withMonitorTargetTransaction(connA, seeded.targetId, async (tx) => {
        locked = true;
        await barrier;
        await tx`
          UPDATE monitor_targets SET label = 'barrier-held', updated_at = statement_timestamp()
          WHERE id = ${seeded.targetId}::uuid
        `;
      });
      await waitUntil(async () => locked, 'target lock');

      const commitPromise = commitBilibiliVideo(connB, {
        jobId: seeded.jobId,
        targetId: seeded.targetId,
        startedAt: new Date('2026-10-21T12:00:00.000Z'),
        durationMs: 12,
        schedule: { minutes: 60, persistMinutes: false },
        sample: {
          bvid: (await getMonitorTarget(sql, seeded.targetId))!.externalId,
          title: '合成视频',
          sampledAt: seeded.scheduledFor,
          rawTime: '2026-10-21 20:00',
          sourceTimezone: 'Asia/Shanghai',
          timestampPrecision: 'minute',
          viewCount: 10n,
          onlineViewers: null,
          onlineViewersRaw: null,
          likeCount: 1n,
          coinCount: 0n,
          favoriteCount: 0n,
          shareCount: 0n,
          danmakuCount: 0n,
          commentCount: 0n,
          source: 'bilibili',
        },
      });

      let waiting = false;
      for (let i = 0; i < 80; i += 1) {
        if ((await countUngrantedLocks(watch)) > 0) {
          waiting = true;
          break;
        }
        await Bun.sleep(10);
      }
      expect(waiting).toBe(true);

      release();
      const [holdResult, committed] = await Promise.all([hold, commitPromise]);
      expect(holdResult).toBeUndefined();
      expect(committed.runId).toBeTruthy();
      expect(committed.inserted).toBe(true);

      const job = await getCollectorJob(sql, seeded.jobId);
      expect(job?.status).toBe('succeeded');
      const runs = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM collector_runs WHERE job_id = ${seeded.jobId}::uuid
      `;
      expect(runs[0]?.n).toBe('1');
    } finally {
      await connA.end({ timeout: 5 });
      await connB.end({ timeout: 5 });
      await watch.end({ timeout: 5 });
    }
  }, 30_000);

  test('commitBilibiliCreator and commitBilibiliDynamic share the same barrier protocol', async () => {
    for (const kind of ['creator', 'dynamic'] as const) {
      const externalId = kind === 'creator' ? String(++midSeq) : (dynSeq++).toString();
      const seeded = await seedRunningJob({ type: kind, externalId });
      const connA = extraConn();
      const connB = extraConn();
      try {
        let release = (): void => undefined;
        const barrier = new Promise<void>((resolve) => {
          release = resolve;
        });
        let locked = false;
        const hold = withMonitorTargetTransaction(connA, seeded.targetId, async () => {
          locked = true;
          await barrier;
        });
        await waitUntil(async () => locked, `${kind} lock`);

        const commitPromise =
          kind === 'creator'
            ? commitBilibiliCreator(connB, {
                jobId: seeded.jobId,
                targetId: seeded.targetId,
                startedAt: new Date(),
                durationMs: 8,
                schedule: { minutes: 240, persistMinutes: false },
                sample: {
                  mid: externalId,
                  uname: '合成UP',
                  sampledAt: seeded.scheduledFor,
                  rawTime: '2026-10-21 20:00',
                  sourceTimezone: 'Asia/Shanghai',
                  timestampPrecision: 'minute',
                  followerCount: 99n,
                  followingCount: 1n,
                  source: 'bilibili',
                },
              })
            : commitBilibiliDynamic(connB, {
                jobId: seeded.jobId,
                targetId: seeded.targetId,
                startedAt: new Date(),
                durationMs: 8,
                schedule: { minutes: 60, persistMinutes: false },
                sample: {
                  dynamicId: externalId,
                  authorMid: String(++midSeq),
                  authorName: '动态作者',
                  text: '合成动态',
                  likeCount: 3n,
                  repostCount: 0n,
                  commentCount: 0n,
                  sampledAt: seeded.scheduledFor,
                  collectedAt: new Date(),
                  rawTime: '2026-10-21 20:00',
                  sourceTimezone: 'Asia/Shanghai',
                  timestampPrecision: 'second',
                  source: 'bilibili',
                  accountId: null,
                  collectorRunId: null,
                  extra: {},
                },
              });

        await Bun.sleep(40);
        release();
        const [, committed] = await Promise.all([hold, commitPromise]);
        expect(committed.inserted).toBe(true);
        const job = await getCollectorJob(sql, seeded.jobId);
        expect(job?.status).toBe('succeeded');
      } finally {
        await connA.end({ timeout: 5 });
        await connB.end({ timeout: 5 });
      }
    }
  }, 60_000);

  test('retryable failure preserves run FK then rearrange keeps single active opportunity', async () => {
    const now = new Date('2026-10-21T13:00:00.000Z');
    const created = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: nextBvid(),
      label: 'retry',
      tags: [],
      intervalMinutes: 60,
      now,
    });
    const jobId = created.jobId!;
    await sql`
      UPDATE collector_jobs
      SET status = 'running', started_at = ${now}, attempts = 1
      WHERE id = ${jobId}::uuid
    `;
    const failed = await recordCollectorFailure(sql, {
      jobId,
      targetId: created.target.id,
      attempts: 1,
      maxAttempts: 3,
      error: 'transient',
      durationMs: 5,
      startedAt: now,
      retryAt: new Date(now.getTime() + 60_000),
    });
    expect(failed.terminal).toBe(false);

    const runsBefore = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM collector_runs WHERE job_id = ${jobId}::uuid
    `;
    expect(runsBefore[0]?.n).toBe('1');

    // Second pending planted beside the retrying job (old-snapshot style).
    const extraId = crypto.randomUUID();
    const staleBucket = new Date(now.getTime() - 3_600_000);
    await sql`
      INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for)
      VALUES (${extraId}::uuid, ${created.target.id}::uuid, 'pending', 0, ${staleBucket})
    `;

    const manual = await requestCollectorRun(sql, created.target.id, new Date(now.getTime() + 1));
    expect(manual.status).toBe('queued');
    if (manual.status !== 'queued') throw new Error('expected queued');
    expect(manual.job.id).toBe(jobId);
    expect(manual.created).toBe(false);

    const active = await sql<{ id: string; status: string; error: string | null }[]>`
      SELECT id::text AS id, status, error FROM collector_jobs
      WHERE target_id = ${created.target.id}::uuid AND status IN ('pending', 'running')
    `;
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(jobId);

    const extra = await getCollectorJob(sql, extraId);
    expect(extra).toBeNull();

    const runsAfter = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM collector_runs WHERE job_id = ${jobId}::uuid
    `;
    expect(runsAfter[0]?.n).toBe('1');
  });

  test('terminal failure and defer use target→job locks without half updates', async () => {
    const seeded = await seedRunningJob({ type: 'video', externalId: nextBvid() });
    const terminal = await recordCollectorFailure(sql, {
      jobId: seeded.jobId,
      targetId: seeded.targetId,
      attempts: 3,
      maxAttempts: 3,
      error: 'give-up',
      durationMs: 3,
      startedAt: new Date(),
      retryAt: null,
    });
    expect(terminal.terminal).toBe(true);
    expect((await getCollectorJob(sql, seeded.jobId))?.status).toBe('failed');

    const again = await seedRunningJob({ type: 'video', externalId: nextBvid() });
    const until = new Date('2026-10-21T15:00:00.000Z');
    await deferCollectorJob(sql, again.jobId, until);
    const deferred = await getCollectorJob(sql, again.jobId);
    expect(deferred?.status).toBe('pending');
    expect(deferred?.scheduledFor.toISOString()).toBe(until.toISOString());
  });

  test('enqueue after target-lock barrier re-reads cursor and does not insert stale bucket', async () => {
    const dueAt = new Date('2026-10-20T00:00:00.000Z');
    const created = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: nextBvid(),
      label: 'stale-enqueue',
      tags: [],
      intervalMinutes: 60,
      now: dueAt,
    });
    await sql`DELETE FROM collector_jobs WHERE target_id = ${created.target.id}::uuid`;
    await sql`
      UPDATE monitor_targets
      SET next_run_at = ${dueAt}, enabled = true
      WHERE id = ${created.target.id}::uuid
    `;

    const connA = extraConn();
    const connB = extraConn();
    const watch = extraConn();
    try {
      let release = (): void => undefined;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked = false;
      const future = new Date('2026-10-22T00:00:00.000Z');
      const hold = withMonitorTargetTransaction(connA, created.target.id, async (tx) => {
        locked = true;
        await barrier;
        await tx`
          UPDATE monitor_targets
          SET next_run_at = ${future}, label = 'advanced', updated_at = statement_timestamp()
          WHERE id = ${created.target.id}::uuid
        `;
      });
      await waitUntil(async () => locked, 'enqueue barrier lock');

      const enqueuePromise = enqueueDueCollectorJobs(connB);
      let waiting = false;
      for (let i = 0; i < 80; i += 1) {
        if ((await countUngrantedLocks(watch)) > 0) {
          waiting = true;
          break;
        }
        await Bun.sleep(10);
      }
      expect(waiting).toBe(true);
      release();
      const [, enqueued] = await Promise.all([hold, enqueuePromise]);
      expect(enqueued).toBe(0);
      const pendings = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM collector_jobs
        WHERE target_id = ${created.target.id}::uuid AND status = 'pending'
      `;
      expect(pendings[0]?.n).toBe('0');
      const target = await getMonitorTarget(sql, created.target.id);
      expect(target?.nextRunAt?.toISOString()).toBe(future.toISOString());
    } finally {
      await connA.end({ timeout: 5 });
      await connB.end({ timeout: 5 });
      await watch.end({ timeout: 5 });
    }
  }, 30_000);

  test('concurrent manual / manual+enqueue / dual claim keep one opportunity; other targets stay free', async () => {
    const now = new Date('2026-10-21T14:00:00.000Z');
    const a = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: nextBvid(),
      label: 'a',
      tags: [],
      intervalMinutes: 60,
      now,
    });
    await sql`DELETE FROM collector_jobs WHERE target_id = ${a.target.id}::uuid`;
    await sql`
      UPDATE monitor_targets SET next_run_at = ${now}, enabled = true WHERE id = ${a.target.id}::uuid
    `;

    const b = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: nextBvid(),
      label: 'b',
      tags: [],
      intervalMinutes: 60,
      now,
    });

    const c1 = extraConn();
    const c2 = extraConn();
    const c3 = extraConn();
    try {
      let release = (): void => undefined;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked = false;
      const hold = withMonitorTargetTransaction(c1, a.target.id, async () => {
        locked = true;
        await barrier;
      });
      await waitUntil(async () => locked, 'manual barrier');

      const manualA = requestCollectorRun(c2, a.target.id, now);
      const enqueueA = enqueueDueCollectorJobs(c3);
      // Other target must not block on A's lock.
      const other = await requestCollectorRun(sql, b.target.id, now);
      expect(other.status).toBe('queued');

      release();
      const [, man, enq] = await Promise.all([hold, manualA, enqueueA]);
      expect(man.status).toBe('queued');
      const activeA = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM collector_jobs
        WHERE target_id = ${a.target.id}::uuid AND status IN ('pending', 'running')
      `;
      expect(activeA[0]?.n).toBe('1');
      expect(enq === 0 || enq === 1).toBe(true);

      // Dual claim on the same target: park other targets so only A is claimable.
      await sql`
        UPDATE collector_jobs
        SET status = 'succeeded', finished_at = statement_timestamp()
        WHERE target_id <> ${a.target.id}::uuid AND status IN ('pending', 'running')
      `;
      await sql`
        UPDATE collector_jobs
        SET status = 'pending', scheduled_for = ${now}, attempts = 0, started_at = NULL, finished_at = NULL
        WHERE id = (
          SELECT id FROM collector_jobs
          WHERE target_id = ${a.target.id}::uuid AND status IN ('pending', 'running', 'succeeded')
          ORDER BY created_at DESC
          LIMIT 1
        )
      `;
      await sql`
        DELETE FROM collector_jobs
        WHERE target_id = ${a.target.id}::uuid
          AND status = 'pending'
          AND id NOT IN (
            SELECT id FROM collector_jobs
            WHERE target_id = ${a.target.id}::uuid
            ORDER BY created_at DESC
            LIMIT 1
          )
      `;
      const claim1 = claimNextCollectorJob(c2);
      const claim2 = claimNextCollectorJob(c3);
      const [one, two] = await Promise.all([claim1, claim2]);
      const claimed = [one, two].filter(Boolean);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.targetId).toBe(a.target.id);
      const running = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM collector_jobs
        WHERE target_id = ${a.target.id}::uuid AND status = 'running'
      `;
      expect(running[0]?.n).toBe('1');
    } finally {
      await c1.end({ timeout: 5 });
      await c2.end({ timeout: 5 });
      await c3.end({ timeout: 5 });
    }
  }, 30_000);

  test('two pendings with failed-run history converge, succeed, then next cycle enqueues', async () => {
    const t0 = new Date('2026-10-21T10:00:00.000Z');
    const created = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: nextBvid(),
      label: 'converge-cycle',
      tags: [],
      intervalMinutes: 60,
      now: t0,
    });
    const primaryId = created.jobId!;
    await sql`
      UPDATE collector_jobs
      SET status = 'running', started_at = ${t0}, attempts = 1
      WHERE id = ${primaryId}::uuid
    `;
    await recordCollectorFailure(sql, {
      jobId: primaryId,
      targetId: created.target.id,
      attempts: 1,
      maxAttempts: 3,
      error: 'first-fail',
      durationMs: 4,
      startedAt: t0,
      retryAt: t0,
    });

    const orphanId = crypto.randomUUID();
    const orphanBucket = new Date(t0.getTime() - 60_000);
    await sql`
      INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for)
      VALUES (${orphanId}::uuid, ${created.target.id}::uuid, 'pending', 0, ${orphanBucket})
    `;
    // Orphan also has a failed run (the FK-preserving case).
    await sql`
      INSERT INTO collector_runs (
        id, job_id, target_id, status, samples_written, duration_ms, error, started_at, finished_at
      ) VALUES (
        ${crypto.randomUUID()}::uuid, ${orphanId}::uuid, ${created.target.id}::uuid,
        'failed', 0, 1, 'old', ${t0}, ${t0}
      )
    `;

    await withMonitorTargetTransaction(sql, created.target.id, async (tx, target) => {
      expect(target).toBeTruthy();
      await convergeActiveJobsUnderTargetLock(tx, target!);
    });

    const active = await sql<{ id: string; status: string; error: string | null }[]>`
      SELECT id::text AS id, status, error FROM collector_jobs
      WHERE target_id = ${created.target.id}::uuid
      ORDER BY created_at
    `;
    const pendingOrRunning = active.filter(
      (row) => row.status === 'pending' || row.status === 'running',
    );
    expect(pendingOrRunning).toHaveLength(1);
    expect(pendingOrRunning[0]?.id).toBe(primaryId);
    const superseded = active.find((row) => row.id === orphanId);
    expect(superseded?.status).toBe('failed');
    expect(superseded?.error).toBe(SUPERSEDED_ACTIVE_JOB_ERROR);
    const orphanRuns = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM collector_runs WHERE job_id = ${orphanId}::uuid
    `;
    expect(orphanRuns[0]?.n).toBe('1');

    await sql`
      UPDATE collector_jobs
      SET status = 'running', started_at = statement_timestamp(), attempts = attempts + 1
      WHERE id = ${primaryId}::uuid
    `;
    const finishedAt = new Date('2026-10-21T10:05:00.000Z');
    await recordCollectorSuccess(sql, {
      jobId: primaryId,
      targetId: created.target.id,
      samplesWritten: 1,
      durationMs: 10,
      startedAt: t0,
      schedule: { minutes: 60, persistMinutes: true },
    });
    // Force next cycle due.
    const nextDue = new Date(finishedAt.getTime() - 1000);
    await sql`
      UPDATE monitor_targets SET next_run_at = ${nextDue}, enabled = true
      WHERE id = ${created.target.id}::uuid
    `;
    const enqueued = await enqueueDueCollectorJobs(sql);
    expect(enqueued).toBeGreaterThanOrEqual(1);
    const claimed = await claimNextCollectorJob(sql);
    expect(claimed?.targetId).toBe(created.target.id);
    expect(claimed?.id).not.toBe(primaryId);
  });

  test('same bucket sample conflict rolls back cleanly; pause blocks claim but allows running finish', async () => {
    const seeded = await seedRunningJob({ type: 'video', externalId: nextBvid() });
    const bvid = (await getMonitorTarget(sql, seeded.targetId))!.externalId;
    const sample = {
      bvid,
      title: 'bucket',
      sampledAt: seeded.scheduledFor,
      rawTime: '2026-10-21 20:00',
      sourceTimezone: 'Asia/Shanghai' as const,
      timestampPrecision: 'minute' as const,
      viewCount: 1n,
      onlineViewers: null,
      onlineViewersRaw: null,
      likeCount: 0n,
      coinCount: 0n,
      favoriteCount: 0n,
      shareCount: 0n,
      danmakuCount: 0n,
      commentCount: 0n,
      source: 'bilibili' as const,
    };
    const first = await commitBilibiliVideo(sql, {
      jobId: seeded.jobId,
      targetId: seeded.targetId,
      startedAt: new Date(),
      durationMs: 5,
      sample,
      schedule: { minutes: 60, persistMinutes: false },
    });
    expect(first.inserted).toBe(true);

    const seeded2 = await seedRunningJob({ type: 'video', externalId: nextBvid() });
    const bvid2 = (await getMonitorTarget(sql, seeded2.targetId))!.externalId;
    // Pre-insert conflicting sample bucket then commit should insert=false but succeed job.
    await sql`
      INSERT INTO videos (bvid, title) VALUES (${bvid2}, 'pre')
    `;
    await sql`
      INSERT INTO video_metric_samples (
        bvid, sampled_at, source_timezone, raw_time, timestamp_precision, view_count, source
      ) VALUES (
        ${bvid2}, ${seeded2.scheduledFor}, 'Asia/Shanghai', 'x', 'minute', 9, 'import'
      )
    `;
    const dup = await commitBilibiliVideo(sql, {
      jobId: seeded2.jobId,
      targetId: seeded2.targetId,
      startedAt: new Date(),
      durationMs: 5,
      sample: { ...sample, bvid: bvid2, sampledAt: seeded2.scheduledFor, viewCount: 99n },
      schedule: { minutes: 60, persistMinutes: false },
    });
    expect(dup.inserted).toBe(false);
    expect((await getCollectorJob(sql, seeded2.jobId))?.status).toBe('succeeded');
    const kept = await sql<{ view_count: string }[]>`
      SELECT view_count::text AS view_count FROM video_metric_samples
      WHERE bvid = ${bvid2} AND sampled_at = ${seeded2.scheduledFor}
    `;
    expect(kept[0]?.view_count).toBe('9');

    const paused = await seedRunningJob({ type: 'video', externalId: nextBvid() });
    await updateMonitorTarget(sql, paused.targetId, { enabled: false }, new Date());
    // Plant a due pending that must not be claimed while paused.
    const pendingId = crypto.randomUUID();
    await sql`
      INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for)
      VALUES (
        ${pendingId}::uuid, ${paused.targetId}::uuid, 'pending', 0,
        ${new Date('2026-10-01T00:00:00.000Z')}
      )
    `;
    const claimedWhilePaused = await claimNextCollectorJob(sql);
    if (claimedWhilePaused) {
      expect(claimedWhilePaused.targetId).not.toBe(paused.targetId);
    }
    // Running job may still finish.
    const finish = await recordCollectorSuccess(sql, {
      jobId: paused.jobId,
      targetId: paused.targetId,
      samplesWritten: 0,
      durationMs: 1,
      startedAt: new Date(),
      schedule: { minutes: 60, persistMinutes: false },
    });
    expect(finish.runId).toBeTruthy();
    expect((await getCollectorJob(sql, paused.jobId))?.status).toBe('succeeded');
  });

  test('duplicate create does not resume paused target; soft-delete blocks claim', async () => {
    const externalId = nextBvid();
    const created = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId,
      label: 'dup',
      tags: [],
      intervalMinutes: 60,
      now: new Date(),
    });
    await updateMonitorTarget(sql, created.target.id, { enabled: false }, new Date());
    const again = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId,
      label: 'dup-2',
      tags: [],
      intervalMinutes: 60,
      now: new Date(),
    });
    expect(again.created).toBe(false);
    expect(again.target.id).toBe(created.target.id);
    expect(again.target.enabled).toBe(false);

    await softDeleteMonitorTarget(sql, created.target.id);
    const run = await requestCollectorRun(sql, created.target.id, new Date());
    expect(run.status).toBe('deleted');
  });

  test('resume + enqueue does not create a second active job', async () => {
    const created = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: nextBvid(),
      label: 'resume',
      tags: [],
      intervalMinutes: 60,
      now: new Date('2026-10-21T08:00:00.000Z'),
    });
    await updateMonitorTarget(sql, created.target.id, { enabled: false }, new Date());
    await sql`DELETE FROM collector_jobs WHERE target_id = ${created.target.id}::uuid AND status = 'pending'`;
    const resumed = await updateMonitorTarget(
      sql,
      created.target.id,
      { enabled: true },
      new Date('2026-10-21T16:00:00.000Z'),
    );
    expect(resumed.status).toBe('updated');
    const enqueued = await enqueueDueCollectorJobs(sql);
    void enqueued;
    const active = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM collector_jobs
      WHERE target_id = ${created.target.id}::uuid AND status IN ('pending', 'running')
    `;
    expect(active[0]?.n).toBe('1');
  });
});
