import { describe, expect, test } from 'bun:test';
import { PERSISTED_INFO_EVENTS, shouldPersistLog } from './policy';
import { REDACT_PATHS } from './redact';
import { createLogger, type AppLogInsert, type LogSink } from './logger';
import {
  readRetentionDays,
  APP_LOG_RETENTION_DAYS,
  APP_LOG_RETENTION_INTERVAL_MS,
} from './retention';

const SECRET_SESS = 'plain-sess-value-9f3a';
const SECRET_JCT = 'plain-jct-value-9f3a';
const SECRET_BEARER = 'abc.def-GHI_9';
const SECRET_PASSWORD = 'pw-secret-value';
const SECRET_CIPHER = 'ct-secret-value';

function capture() {
  const lines: string[] = [];
  const rows: {
    level: string;
    event: string | null;
    message: string;
    context: Record<string, unknown>;
  }[] = [];
  const sink: LogSink = {
    async write(batch: readonly AppLogInsert[]) {
      for (const row of batch) {
        rows.push({
          level: row.level,
          event: row.event,
          message: row.message,
          context: row.context,
        });
      }
    },
  };
  const logger = createLogger({
    service: 'api',
    instance: 'test',
    envName: 'test',
    level: 'debug',
    destination: (line) => lines.push(line),
    sink,
  });
  return { lines, rows, logger };
}

describe('redaction', () => {
  test('covers the agreed pino paths', () => {
    expect([...REDACT_PATHS]).toEqual([
      'req.headers.cookie',
      'req.headers.authorization',
      '*.SESSDATA',
      '*.bili_jct',
      '*.password',
      '*.secret',
      '*.ciphertext',
    ]);
  });

  test('stdout and the sink omit SESSDATA, bili_jct, and bearer plaintext', async () => {
    const captured = capture();
    captured.logger.error(
      `boom SESSDATA=${SECRET_SESS}; bili_jct=${SECRET_JCT} Bearer ${SECRET_BEARER}`,
      {
        event: 'http.error',
        context: {
          password: SECRET_PASSWORD,
          ciphertext: SECRET_CIPHER,
          SESSDATA: SECRET_SESS,
          nested: { bili_jct: SECRET_JCT, secret: 'nested-secret' },
          req: {
            headers: {
              cookie: `SESSDATA=${SECRET_SESS}`,
              authorization: `Bearer ${SECRET_BEARER}`,
            },
          },
        },
        err: new Error(`SESSDATA=${SECRET_SESS}; bili_jct=${SECRET_JCT}`),
      },
    );
    await captured.logger.flush();
    const stdout = captured.lines.join('\n');
    const stored = JSON.stringify(captured.rows);
    for (const secret of [
      SECRET_SESS,
      SECRET_JCT,
      SECRET_BEARER,
      SECRET_PASSWORD,
      SECRET_CIPHER,
      'nested-secret',
    ]) {
      expect(stdout).not.toContain(secret);
      expect(stored).not.toContain(secret);
    }
    expect(stdout).not.toMatch(/SESSDATA|bili_jct|password|ciphertext/);
    expect(stored).not.toMatch(/SESSDATA|bili_jct|password|ciphertext/);
    const parsed = JSON.parse(captured.lines[0] ?? '{}') as {
      err?: { type: string; message: string; stack: string | null; code: null };
    };
    expect(parsed.err?.type).toBe('Error');
    expect(parsed.err).toHaveProperty('message');
    expect(parsed.err).toHaveProperty('stack');
    expect(parsed.err).toHaveProperty('code');
  });
});

describe('app_logs write policy', () => {
  test('stores warn/error and the info lifecycle whitelist only', async () => {
    const captured = capture();
    captured.logger.debug('hidden', { event: 'job.claimed' });
    captured.logger.info('access', { event: 'http.request' });
    captured.logger.info('claimed', { event: 'job.claimed' });
    captured.logger.info('backfill', { event: 'backfill.started' });
    captured.logger.warn('careful', { event: 'other' });
    captured.logger.error('bad', { event: 'http.error' });
    await captured.logger.flush();
    expect(captured.rows.map((row) => `${row.level}:${row.event}`)).toEqual([
      'info:job.claimed',
      'info:backfill.started',
      'warn:other',
      'error:http.error',
    ]);
    expect(PERSISTED_INFO_EVENTS).toContain('circuit.open');
    expect(PERSISTED_INFO_EVENTS).toContain('auth.login');
    expect(PERSISTED_INFO_EVENTS).toContain('service.started');
    expect(PERSISTED_INFO_EVENTS).toContain('legacy.sync.started');
    expect(PERSISTED_INFO_EVENTS).toContain('legacy.sync.finished');
    expect(PERSISTED_INFO_EVENTS).toContain('legacy.sync.failed');
    expect(shouldPersistLog('info', 'http.request')).toBe(false);
    expect(shouldPersistLog('warn', null)).toBe(true);
  });

  test('a failing sink does not throw and does not echo the secret', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: 'collector',
      instance: 'test',
      level: 'info',
      destination: (line) => lines.push(line),
      sink: {
        async write() {
          throw new Error(`db down SESSDATA=${SECRET_SESS}`);
        },
      },
    });
    expect(() => logger.error('still running', { event: 'job.failed' })).not.toThrow();
    await logger.flush();
    expect(lines.join('\n')).not.toContain(SECRET_SESS);
    expect(lines.some((line) => line.includes('log.sink_failed'))).toBe(true);
  });
});

describe('retention parameters', () => {
  test('defaults to 14 days and 6 hours', () => {
    expect(APP_LOG_RETENTION_DAYS).toBe(14);
    expect(APP_LOG_RETENTION_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    expect(readRetentionDays({})).toBe(14);
    expect(readRetentionDays({ APP_LOG_RETENTION_DAYS: '30' })).toBe(30);
    expect(() => readRetentionDays({ APP_LOG_RETENTION_DAYS: '0' })).toThrow();
  });
});
