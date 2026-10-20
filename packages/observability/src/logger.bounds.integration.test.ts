import { afterAll, describe, expect, test } from 'bun:test';
import { createRetainedTestDatabase, type Sql } from '@studio/db';
import { createLogger } from './logger';
import { createPgLogSink } from './pg-sink';
import { evidence } from './lifecycle-process';

const SECRET_SESS = 'plain-sess-value-9f3a';
const SECRET_JCT = 'plain-jct-value-9f3a';
const SECRET_BEARER = 'abc.def-GHI_9';

describe('log bounds redaction against postgres', () => {
  const open: Sql[] = [];

  afterAll(async () => {
    for (const sql of open) await sql.end({ timeout: 5 }).catch(() => undefined);
  });

  test('overflow, sink failure, and flush timeout stay redacted on stdout and in app_logs', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    const sql = isolated.sql;
    const lines: string[] = [];
    const destination = (line: string) => lines.push(line);
    const pg = createPgLogSink(sql, {
      destination,
      service: 'api',
      instance: 'redact',
      envName: 'test',
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hangNext = true;
    const logger = createLogger({
      service: 'api',
      instance: 'redact',
      envName: 'test',
      level: 'info',
      limitsEnv: {},
      maxRecords: 2,
      destination,
      sink: {
        async write(rows) {
          const result = await pg.write(rows);
          if (hangNext) {
            hangNext = false;
            await gate;
          }
          return result;
        },
      },
    });
    logger.error(`Cookie SESSDATA=${SECRET_SESS}; bili_jct=${SECRET_JCT} Bearer ${SECRET_BEARER}`, {
      event: 'http.error',
      context: {
        note: 'visible',
        cookie: `SESSDATA=${SECRET_SESS}`,
        authorization: `Bearer ${SECRET_BEARER}`,
        SESSDATA: SECRET_SESS,
        bili_jct: SECRET_JCT,
      },
    });
    logger.warn('kept', { event: 'cap' });
    logger.warn(`dropped SESSDATA=${SECRET_SESS}; bili_jct=${SECRET_JCT}`, {
      event: 'cap',
      context: { authorization: `Bearer ${SECRET_BEARER}` },
    });
    const timed = await logger.flushWithin(200);
    expect(timed.ok).toBe(false);
    expect(timed.reason).toBe('timeout');
    release();
    await logger.flush();
    const errorLogger = createLogger({
      service: 'api',
      instance: 'redact-error',
      envName: 'test',
      level: 'info',
      limitsEnv: {},
      destination,
      sink: {
        async write() {
          throw new Error(
            `db down SESSDATA=${SECRET_SESS}; bili_jct=${SECRET_JCT} Bearer ${SECRET_BEARER}`,
          );
        },
      },
    });
    errorLogger.error('sink', {
      event: 'http.error',
      context: { cookie: `SESSDATA=${SECRET_SESS}`, authorization: `Bearer ${SECRET_BEARER}` },
    });
    await errorLogger.flush();

    const rows = await sql<{ event: string | null; message: string; context: string; n: string }[]>`
      SELECT event, message, context::text AS context, count(*) OVER () AS n
      FROM app_logs
      WHERE instance IN ('redact', 'redact-error')
      ORDER BY id
    `;
    const stored = JSON.stringify(rows);
    const stdout = lines.join('\n');
    for (const secret of [SECRET_SESS, SECRET_JCT, SECRET_BEARER]) {
      expect(stored).not.toContain(secret);
      expect(stdout).not.toContain(secret);
    }
    expect(stored).not.toMatch(/SESSDATA|bili_jct/);
    expect(stdout).not.toMatch(/SESSDATA|bili_jct/);
    expect(rows.filter((row) => row.event === 'http.error')).toHaveLength(1);
    expect(rows.filter((row) => row.message === 'kept')).toHaveLength(1);
    expect(rows.some((row) => row.message.includes('dropped'))).toBe(false);
    expect(stdout).toContain('log.queue_overflow');
    expect(stdout).toContain('log.flush_timeout');
    expect(stdout).toContain('log.sink_failed');
    const again = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app_logs WHERE instance = 'redact'
    `;
    expect(again[0]?.count).toBe('2');
    evidence({
      case: 'logger-redaction',
      database: isolated.databaseName,
      instances: ['redact', 'redact-error'],
      logCount: rows.length,
      rejectedRecords: logger.stats().rejectedRecords,
      flushTimeouts: logger.stats().flushTimeouts,
      sinkFailures: errorLogger.stats().sinkFailures,
      peakPendingRecords: logger.stats().peakPendingRecords,
    });
  }, 30_000);
});
