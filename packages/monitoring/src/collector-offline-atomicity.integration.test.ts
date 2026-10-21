import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createRetainedTestDatabase,
  getCollectorJob,
  insertMonitorTarget,
  type Sql,
} from '@studio/db';
import { createOfflineProvider } from './offline-provider';
import { readCollectorConfig, runCollectorOnce } from './collector-runner';

describe('offline collector commit atomicity (WP-R2-17R0 correction)', () => {
  let sql: Sql;
  let databaseName = '';

  beforeAll(async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_17r0_off');
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    console.log(`RETAINED_DB ${databaseName}`);
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  const config = {
    ...readCollectorConfig({ COLLECTOR_INSTANCE_ID: 'wp-r2-17r0-offline' }),
    pollMs: 20,
    maxAttempts: 3,
    backoffBaseMs: 0,
    backoffCapMs: 0,
    rateLimitMs: 0,
  };

  test('runCollectorOnce offline video success binds sample to run', async () => {
    const provider = createOfflineProvider({ SOURCE_TIMEZONE: 'Asia/Shanghai' });
    const created = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: 'BV1xx411c7mD',
      label: 'offline-ok',
      tags: [],
      intervalMinutes: 60,
      now: new Date(),
    });
    // Park other due jobs so we claim this target.
    await sql`
      UPDATE collector_jobs
      SET scheduled_for = statement_timestamp() + interval '7 days'
      WHERE target_id <> ${created.target.id}::uuid AND status = 'pending'
    `;
    const outcome = await runCollectorOnce({ sql, provider, config });
    expect(outcome).toBe('succeeded');
    const job = await getCollectorJob(sql, created.jobId!);
    expect(job?.status).toBe('succeeded');
    const [sample] = await sql<{ n: string; run_id: string | null; source: string }[]>`
      SELECT count(*)::text AS n,
             max(collector_run_id::text) AS run_id,
             max(source) AS source
      FROM video_metric_samples WHERE bvid = 'BV1xx411c7mD'
    `;
    expect(sample?.n).toBe('1');
    expect(sample?.source).toBe('import');
    expect(sample?.run_id).toBeTruthy();
    const [run] = await sql<{ id: string; samples_written: number }[]>`
      SELECT id::text AS id, samples_written FROM collector_runs
      WHERE job_id = ${created.jobId!}::uuid AND status = 'succeeded'
    `;
    expect(run?.samples_written).toBe(1);
    expect(run?.id).toBe(sample?.run_id ?? undefined);
  });

  test('runCollectorOnce offline video commit fault leaves no orphan sample', async () => {
    const provider = createOfflineProvider({ SOURCE_TIMEZONE: 'Asia/Shanghai' });
    const created = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'video',
      externalId: 'BV1xx411c7mE',
      label: 'offline-fault',
      tags: [],
      intervalMinutes: 60,
      now: new Date(),
    });
    await sql`
      UPDATE collector_jobs
      SET scheduled_for = statement_timestamp() + interval '7 days'
      WHERE target_id <> ${created.target.id}::uuid AND status = 'pending'
    `;
    const outcome = await runCollectorOnce({
      sql,
      provider,
      config,
      commitHooks: {
        afterSampleWritten: async () => {
          throw new Error('forced-offline-commit-fault');
        },
      },
    });
    expect(outcome).toBe('failed');
    const job = await getCollectorJob(sql, created.jobId!);
    expect(job?.status).toBe('pending');
    const [samples] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM video_metric_samples WHERE bvid = 'BV1xx411c7mE'
    `;
    expect(samples?.n).toBe('0');
    const [runs] = await sql<{ statuses: string }[]>`
      SELECT string_agg(status, ',' ORDER BY finished_at) AS statuses
      FROM collector_runs WHERE job_id = ${created.jobId!}::uuid
    `;
    expect(runs?.statuses).toBe('failed');
  });

  test('runCollectorOnce offline creator success and fault stay atomic', async () => {
    const provider = createOfflineProvider({ SOURCE_TIMEZONE: 'Asia/Shanghai' });
    const ok = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'creator',
      externalId: '12345',
      label: 'up-ok',
      tags: [],
      intervalMinutes: 240,
      now: new Date(),
    });
    await sql`
      UPDATE collector_jobs
      SET scheduled_for = statement_timestamp() + interval '7 days'
      WHERE target_id <> ${ok.target.id}::uuid AND status = 'pending'
    `;
    expect(await runCollectorOnce({ sql, provider, config })).toBe('succeeded');
    const [okSample] = await sql<{ n: string; run_id: string | null }[]>`
      SELECT count(*)::text AS n, max(collector_run_id::text) AS run_id
      FROM creator_follower_samples WHERE mid = 12345
    `;
    expect(okSample?.n).toBe('1');
    expect(okSample?.run_id).toBeTruthy();

    const bad = await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'creator',
      externalId: '67890',
      label: 'up-bad',
      tags: [],
      intervalMinutes: 240,
      now: new Date(),
    });
    await sql`
      UPDATE collector_jobs
      SET scheduled_for = statement_timestamp() + interval '7 days'
      WHERE target_id <> ${bad.target.id}::uuid AND status = 'pending'
    `;
    expect(
      await runCollectorOnce({
        sql,
        provider,
        config,
        commitHooks: {
          afterSampleWritten: async () => {
            throw new Error('forced-creator-fault');
          },
        },
      }),
    ).toBe('failed');
    const [badSamples] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM creator_follower_samples WHERE mid = 67890
    `;
    expect(badSamples?.n).toBe('0');
    expect((await getCollectorJob(sql, bad.jobId!))?.status).toBe('pending');
  });
});
