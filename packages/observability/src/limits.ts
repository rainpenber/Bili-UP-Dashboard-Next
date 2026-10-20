export const LOG_QUEUE_MAX_RECORDS = 1000;
export const LOG_QUEUE_MAX_BYTES = 4 * 1024 * 1024;
export const LOG_QUEUE_MAX_RECORDS_CEILING = 100_000;
export const LOG_QUEUE_MAX_BYTES_CEILING = 64 * 1024 * 1024;

export const LOG_FLUSH_DEADLINE_MS = 10_000;
export const PROCESS_EXIT_BUDGET_MS = 20_000;
export const LOG_FLUSH_DEADLINE_CEILING_MS = 60_000;
export const PROCESS_EXIT_BUDGET_CEILING_MS = 120_000;

export const LOG_BATCH_RECORDS = 20;
export const LOG_BATCH_DELAY_MS = 250;

export type LogQueueLimits = {
  maxRecords: number;
  maxBytes: number;
};

export type ShutdownBudgets = {
  flushMs: number;
  exitMs: number;
};

function readBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 超出范围`);
  }
  return value;
}

export function assertBoundedInt(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 超出范围`);
  }
  return value;
}

export function readLogQueueLimits(env: NodeJS.ProcessEnv = process.env): LogQueueLimits {
  return {
    maxRecords: readBoundedInt(
      env.LOG_QUEUE_MAX_RECORDS,
      LOG_QUEUE_MAX_RECORDS,
      1,
      LOG_QUEUE_MAX_RECORDS_CEILING,
      'LOG_QUEUE_MAX_RECORDS',
    ),
    maxBytes: readBoundedInt(
      env.LOG_QUEUE_MAX_BYTES,
      LOG_QUEUE_MAX_BYTES,
      1,
      LOG_QUEUE_MAX_BYTES_CEILING,
      'LOG_QUEUE_MAX_BYTES',
    ),
  };
}

export function readShutdownBudgets(env: NodeJS.ProcessEnv = process.env): ShutdownBudgets {
  const flushMs = readBoundedInt(
    env.LOG_FLUSH_DEADLINE_MS,
    LOG_FLUSH_DEADLINE_MS,
    1,
    LOG_FLUSH_DEADLINE_CEILING_MS,
    'LOG_FLUSH_DEADLINE_MS',
  );
  const exitMs = readBoundedInt(
    env.PROCESS_EXIT_BUDGET_MS,
    PROCESS_EXIT_BUDGET_MS,
    1,
    PROCESS_EXIT_BUDGET_CEILING_MS,
    'PROCESS_EXIT_BUDGET_MS',
  );
  if (exitMs < flushMs) {
    throw new Error('PROCESS_EXIT_BUDGET_MS 必须大于或等于 LOG_FLUSH_DEADLINE_MS');
  }
  return { flushMs, exitMs };
}
