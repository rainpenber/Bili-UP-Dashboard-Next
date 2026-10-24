import { describe, expect, test } from 'bun:test';
import { createLogger } from './logger';
import {
  LOG_FLUSH_DEADLINE_MS,
  LOG_QUEUE_MAX_BYTES,
  LOG_QUEUE_MAX_BYTES_CEILING,
  LOG_QUEUE_MAX_RECORDS,
  LOG_QUEUE_MAX_RECORDS_CEILING,
  PROCESS_EXIT_BUDGET_MS,
  readLogQueueLimits,
  readShutdownBudgets,
} from './limits';

describe('log queue limits', () => {
  test('uses the conservative defaults', () => {
    expect(readLogQueueLimits({})).toEqual({
      maxRecords: LOG_QUEUE_MAX_RECORDS,
      maxBytes: LOG_QUEUE_MAX_BYTES,
    });
    expect(LOG_QUEUE_MAX_RECORDS).toBe(1000);
    expect(LOG_QUEUE_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(
      readLogQueueLimits({ LOG_QUEUE_MAX_RECORDS: ' 40 ', LOG_QUEUE_MAX_BYTES: '2048' }),
    ).toEqual({
      maxRecords: 40,
      maxBytes: 2048,
    });
  });

  test('rejects values that would disable the cap', () => {
    for (const raw of [
      '0',
      '-1',
      '1.5',
      'nope',
      'Infinity',
      '1e99',
      String(LOG_QUEUE_MAX_RECORDS_CEILING + 1),
    ]) {
      expect(() => readLogQueueLimits({ LOG_QUEUE_MAX_RECORDS: raw })).toThrow(
        /LOG_QUEUE_MAX_RECORDS/,
      );
    }
    expect(() =>
      readLogQueueLimits({ LOG_QUEUE_MAX_BYTES: String(LOG_QUEUE_MAX_BYTES_CEILING + 1) }),
    ).toThrow(/LOG_QUEUE_MAX_BYTES/);
    expect(() =>
      createLogger({
        service: 'api',
        limitsEnv: {},
        maxRecords: 0,
        destination: () => undefined,
        sink: { async write() {} },
      }),
    ).toThrow(/maxRecords/);
    expect(() =>
      createLogger({
        service: 'api',
        limitsEnv: { LOG_QUEUE_MAX_BYTES: 'Infinity' },
        destination: () => undefined,
        sink: null,
      }),
    ).toThrow(/LOG_QUEUE_MAX_BYTES/);
  });
});

describe('shutdown budgets', () => {
  test('defaults to 10s flush and 20s exit', () => {
    expect(readShutdownBudgets({})).toEqual({
      flushMs: LOG_FLUSH_DEADLINE_MS,
      exitMs: PROCESS_EXIT_BUDGET_MS,
    });
    expect(LOG_FLUSH_DEADLINE_MS).toBe(10_000);
    expect(PROCESS_EXIT_BUDGET_MS).toBe(20_000);
  });

  test('rejects unlimited or inverted budgets', () => {
    expect(() => readShutdownBudgets({ LOG_FLUSH_DEADLINE_MS: '0' })).toThrow(
      /LOG_FLUSH_DEADLINE_MS/,
    );
    expect(() => readShutdownBudgets({ PROCESS_EXIT_BUDGET_MS: '-5' })).toThrow(
      /PROCESS_EXIT_BUDGET_MS/,
    );
    expect(() =>
      readShutdownBudgets({ LOG_FLUSH_DEADLINE_MS: '5000', PROCESS_EXIT_BUDGET_MS: '1000' }),
    ).toThrow(/PROCESS_EXIT_BUDGET_MS/);
  });
});
