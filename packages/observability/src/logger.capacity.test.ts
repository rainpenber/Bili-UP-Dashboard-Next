import { describe, expect, test } from 'bun:test';
import { evidence } from './lifecycle-process';
import { createLogger, type LogQueueStats } from './logger';
import type { AppLogInsert, LogSink } from './pg-sink';

const SECRET_SESS = 'plain-sess-value-9f3a';
const SECRET_JCT = 'plain-jct-value-9f3a';
const SECRET_BEARER = 'abc.def-GHI_9';

function watch(samples: LogQueueStats[]) {
  return (stats: LogQueueStats) => {
    samples.push(stats);
    expect(stats.pendingRecords).toBeLessThanOrEqual(stats.maxRecords);
    expect(stats.pendingBytes).toBeLessThanOrEqual(stats.maxBytes);
    expect(stats.queuedRecords + stats.stagedRecords + stats.inFlightRecords).toBe(
      stats.pendingRecords,
    );
    expect(stats.queuedBytes + stats.stagedBytes + stats.inFlightBytes).toBe(stats.pendingBytes);
  };
}

describe('bounded log queue', () => {
  test('counts staged and in-flight batches against one budget shared with child loggers', async () => {
    const samples: LogQueueStats[] = [];
    const batches: string[][] = [];
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let hung = false;
    const sink: LogSink = {
      async write(rows: readonly AppLogInsert[]) {
        batches.push(rows.map((row) => row.message));
        if (hung) return;
        hung = true;
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };
    const logger = createLogger({
      service: 'api',
      instance: 'cap',
      envName: 'test',
      level: 'info',
      limitsEnv: {},
      maxRecords: 50,
      maxBytes: 1024 * 1024,
      destination: () => undefined,
      onQueueSample: watch(samples),
      sink,
    });
    const child = logger.child({ requestId: 'child-1' });
    try {
      for (let index = 0; index < 20; index += 1) logger.warn(`m${index}`, { event: 'cap' });
      await enteredPromise;
      for (let index = 20; index < 60; index += 1) child.warn(`m${index}`, { event: 'cap' });
      const stats = logger.stats();
      expect(child.stats()).toEqual(stats);
      expect(stats.inFlightRecords).toBe(20);
      expect(stats.stagedRecords).toBe(20);
      expect(stats.queuedRecords).toBe(10);
      expect(stats.pendingRecords).toBe(50);
      expect(stats.rejectedRecords).toBe(10);
      expect(stats.peakPendingRecords).toBe(50);
      expect(stats.queuedRecords).toBeLessThan(stats.pendingRecords);
      evidence({
        case: 'logger-capacity-records',
        queuedRecords: stats.queuedRecords,
        stagedRecords: stats.stagedRecords,
        inFlightRecords: stats.inFlightRecords,
        pendingRecords: stats.pendingRecords,
        peakPendingRecords: stats.peakPendingRecords,
        rejectedRecords: stats.rejectedRecords,
        maxRecords: stats.maxRecords,
      });
      release();
      await logger.flush();
      expect(batches.flat()).toEqual(Array.from({ length: 50 }, (_, index) => `m${index}`));
      expect(new Set(batches.flat()).size).toBe(50);
      expect(samples.length).toBeGreaterThan(20);
    } finally {
      release?.();
    }
  });

  test('counts serialized bytes, including one oversized context and in-flight rows', async () => {
    const samples: LogQueueStats[] = [];
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const lines: string[] = [];
    let hung = false;
    const sink: LogSink = {
      async write() {
        if (hung) return;
        hung = true;
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };
    const logger = createLogger({
      service: 'collector',
      instance: 'bytes',
      envName: 'test',
      level: 'info',
      limitsEnv: {},
      maxRecords: 5_000,
      maxBytes: 64_000,
      destination: (line) => lines.push(line),
      onQueueSample: watch(samples),
      sink,
    });
    try {
      logger.error('too big', {
        event: 'http.error',
        context: { blob: 'z'.repeat(80_000), SESSDATA: SECRET_SESS },
      });
      expect(logger.stats().pendingRecords).toBe(0);
      expect(logger.stats().rejectedRecords).toBe(1);
      expect(logger.stats().rejectedBytes).toBeGreaterThan(12_000);
      for (let index = 0; index < 80; index += 1) {
        logger.warn(`b${index}`, {
          event: 'cap',
          context: { pad: 'y'.repeat(400), authorization: `Bearer ${SECRET_BEARER}` },
        });
      }
      await enteredPromise;
      const stats = logger.stats();
      expect(stats.inFlightBytes).toBeGreaterThan(0);
      expect(stats.pendingBytes).toBeLessThanOrEqual(64_000);
      expect(stats.rejectedBytes).toBeGreaterThan(64_000);
      expect(stats.peakPendingBytes).toBeLessThanOrEqual(64_000);
      evidence({
        case: 'logger-capacity-bytes',
        queuedBytes: stats.queuedBytes,
        stagedBytes: stats.stagedBytes,
        inFlightBytes: stats.inFlightBytes,
        pendingBytes: stats.pendingBytes,
        peakPendingBytes: stats.peakPendingBytes,
        rejectedBytes: stats.rejectedBytes,
        maxBytes: stats.maxBytes,
      });
      const overflow = lines.filter((line) => line.includes('log.queue_overflow'));
      expect(overflow.length).toBe(1);
      expect(lines.join('\n')).not.toContain(SECRET_SESS);
      expect(lines.join('\n')).not.toContain(SECRET_BEARER);
      expect(overflow[0]).not.toContain('blob');
      expect(overflow[0]).not.toContain('authorization');
    } finally {
      release?.();
      await logger.flushWithin(50);
    }
  });

  test('keeps FIFO batches and the 250ms timer, then accepts new rows after a sink recovers', async () => {
    const batches: string[][] = [];
    let fail = true;
    let writes = 0;
    const lines: string[] = [];
    const logger = createLogger({
      service: 'api',
      instance: 'fifo',
      envName: 'test',
      level: 'info',
      limitsEnv: {},
      maxRecords: 40,
      destination: (line) => lines.push(line),
      sink: {
        async write(rows) {
          writes += 1;
          if (fail) throw new Error(`db down SESSDATA=${SECRET_SESS}; bili_jct=${SECRET_JCT}`);
          batches.push(rows.map((row) => row.message));
        },
      },
    });
    for (let index = 0; index < 25; index += 1) logger.warn(`m${index}`, { event: 'fifo' });
    await logger.flush();
    expect(batches).toEqual([]);
    expect(writes).toBe(2);
    expect(logger.stats().sinkFailures).toBe(2);
    expect(logger.stats().pendingRecords).toBe(0);
    expect(() => logger.warn('still', { event: 'fifo' })).not.toThrow();
    expect(lines.join('\n')).not.toContain(SECRET_SESS);
    expect(lines.join('\n')).not.toContain(SECRET_JCT);
    expect(lines.some((line) => line.includes('log.sink_failed'))).toBe(true);
    const failureLines = lines.filter((line) => line.includes('log.sink_failed'));
    expect(failureLines.length).toBeLessThan(writes);

    fail = false;
    batches.length = 0;
    const recovered: string[][] = [];
    const healthy = createLogger({
      service: 'api',
      instance: 'healthy',
      envName: 'test',
      level: 'info',
      limitsEnv: {},
      destination: () => undefined,
      sink: {
        async write(rows) {
          recovered.push(rows.map((row) => row.message));
        },
      },
    });
    for (let index = 0; index < 25; index += 1) healthy.warn(`m${index}`, { event: 'fifo' });
    await healthy.flush();
    expect(recovered.map((batch) => batch.length)).toEqual([20, 5]);
    expect(recovered.flat()).toEqual(Array.from({ length: 25 }, (_, index) => `m${index}`));

    const timed: string[] = [];
    const timedLogger = createLogger({
      service: 'collector',
      instance: 'timer',
      envName: 'test',
      level: 'info',
      limitsEnv: {},
      destination: () => undefined,
      sink: {
        async write(rows) {
          timed.push(...rows.map((row) => row.message));
        },
      },
    });
    timedLogger.warn('later', { event: 'timer' });
    expect(timed).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(timed).toEqual(['later']);

    healthy.warn('again', { event: 'fifo' });
    await healthy.flush();
    expect(recovered.flat().filter((message) => message === 'm0')).toHaveLength(1);
    expect(recovered.flat().at(-1)).toBe('again');
  });

  test('flush timeout does not rewrite a batch or echo secrets', async () => {
    const seen: string[][] = [];
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const lines: string[] = [];
    let hung = false;
    const logger = createLogger({
      service: 'api',
      instance: 'timeout',
      envName: 'test',
      level: 'info',
      limitsEnv: {},
      destination: (line) => lines.push(line),
      sink: {
        async write(rows) {
          seen.push(rows.map((row) => row.message));
          if (hung) return;
          hung = true;
          started();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      },
    });
    try {
      logger.error(
        `Cookie SESSDATA=${SECRET_SESS}; bili_jct=${SECRET_JCT} Bearer ${SECRET_BEARER}`,
        {
          event: 'http.error',
          context: {
            cookie: `SESSDATA=${SECRET_SESS}`,
            authorization: `Bearer ${SECRET_BEARER}`,
            bili_jct: SECRET_JCT,
          },
        },
      );
      for (let index = 0; index < 19; index += 1) logger.warn(`m${index}`, { event: 'timeout' });
      await startedPromise;
      const timed = await logger.flushWithin(40);
      expect(timed.ok).toBe(false);
      expect(timed.reason).toBe('timeout');
      expect(logger.stats().flushTimeouts).toBe(1);
      expect(logger.stats().inFlightRecords).toBe(20);
      const timeoutLine = lines.find((line) => line.includes('log.flush_timeout')) ?? '';
      expect(timeoutLine).not.toContain(SECRET_SESS);
      expect(timeoutLine).not.toContain(SECRET_JCT);
      expect(timeoutLine).not.toContain(SECRET_BEARER);
      expect(lines.join('\n')).not.toContain(SECRET_SESS);
      release();
      await logger.flush();
      logger.warn('after', { event: 'timeout' });
      await logger.flush();
      expect(seen).toHaveLength(2);
      expect(seen[0]).toHaveLength(20);
      expect(seen[1]).toEqual(['after']);
    } finally {
      release?.();
    }
  });
});
