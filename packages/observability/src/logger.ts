import pino from 'pino';
import type { Sql } from '@studio/db';
import {
  assertBoundedInt,
  LOG_BATCH_DELAY_MS,
  LOG_BATCH_RECORDS,
  LOG_QUEUE_MAX_BYTES_CEILING,
  LOG_QUEUE_MAX_RECORDS_CEILING,
  readLogQueueLimits,
} from './limits';
import { shouldPersistLog } from './policy';
import { REDACT_PATHS, scrubString, scrubValue } from './redact';
import { createPgLogSink, type AppLogInsert, type LogSink, type LogSinkFailure } from './pg-sink';
import type { LogFlushResult } from './shutdown';

export type { AppLogInsert, LogSink };

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = {
  event?: string;
  requestId?: string;
  jobId?: string;
  runId?: string;
  targetId?: string;
  context?: Record<string, unknown>;
  err?: unknown;
};

export type LogBindings = {
  requestId?: string;
  jobId?: string;
  runId?: string;
  targetId?: string;
};

export type LogQueueStats = {
  queuedRecords: number;
  stagedRecords: number;
  inFlightRecords: number;
  pendingRecords: number;
  queuedBytes: number;
  stagedBytes: number;
  inFlightBytes: number;
  pendingBytes: number;
  maxRecords: number;
  maxBytes: number;
  rejectedRecords: number;
  rejectedBytes: number;
  sinkFailures: number;
  flushTimeouts: number;
  peakPendingRecords: number;
  peakPendingBytes: number;
  batchesWritten: number;
  batchesFailed: number;
};

export type StudioLogger = {
  child(bindings: LogBindings): StudioLogger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  flush(): Promise<void>;
  stats?(): LogQueueStats;
  flushWithin?(timeoutMs: number): Promise<LogFlushResult>;
};

export type ManagedStudioLogger = Omit<StudioLogger, 'child'> & {
  child(bindings: LogBindings): ManagedStudioLogger;
  stats(): LogQueueStats;
  flushWithin(timeoutMs: number): Promise<LogFlushResult>;
  /** False only when this call was refused by the bounded queue. */
  notePersisted(level: LogLevel, message: string, fields?: LogFields): boolean;
};

export type CreateLoggerOptions = {
  service: 'api' | 'collector';
  instance?: string | null;
  envName?: string;
  level?: LogLevel;
  destination?: (line: string) => void;
  sink?: LogSink | null;
  sql?: Sql;
  maxRecords?: number;
  maxBytes?: number;
  limitsEnv?: NodeJS.ProcessEnv;
  onQueueSample?: (stats: LogQueueStats) => void;
};

type SerializedErr = {
  type: string;
  message: string;
  stack: string | null;
  code: string | number | null;
};

type ShapedLog = {
  level: string;
  time: string;
  service: string;
  instance: string | null;
  env: string;
  msg: string;
  event: string | null;
  requestId: string | null;
  jobId: string | null;
  runId: string | null;
  targetId: string | null;
  context: Record<string, unknown>;
  err?: SerializedErr;
};

const NUMERIC_LEVELS: Record<string, string> = {
  '10': 'trace',
  '20': 'debug',
  '30': 'info',
  '40': 'warn',
  '50': 'error',
  '60': 'fatal',
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function serializeErr(err: unknown): SerializedErr {
  if (!err || typeof err !== 'object') {
    return {
      type: 'Error',
      message: scrubString(err === undefined || err === null ? '' : String(err)),
      stack: null,
      code: null,
    };
  }
  const record = err as {
    type?: unknown;
    name?: unknown;
    message?: unknown;
    stack?: unknown;
    code?: unknown;
  };
  const named =
    typeof record.type === 'string' && record.type.length > 0
      ? record.type
      : typeof record.name === 'string' && record.name.length > 0
        ? record.name
        : 'Error';
  const code = record.code;
  return {
    type: scrubString(named),
    message: scrubString(typeof record.message === 'string' ? record.message : ''),
    stack: typeof record.stack === 'string' ? scrubString(record.stack) : null,
    code: typeof code === 'string' || typeof code === 'number' ? code : null,
  };
}

function levelLabel(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return NUMERIC_LEVELS[value] ?? value;
  if (typeof value === 'number') return NUMERIC_LEVELS[String(value)] ?? 'info';
  return 'info';
}

function shapeRecord(
  raw: Record<string, unknown>,
  fallback: { service: string; instance: string | null; env: string },
): ShapedLog {
  const contextRaw = scrubValue(raw.context ?? {});
  const context =
    contextRaw && typeof contextRaw === 'object' && !Array.isArray(contextRaw)
      ? (contextRaw as Record<string, unknown>)
      : {};
  const shaped: ShapedLog = {
    level: levelLabel(raw.level),
    time: asString(raw.time) ?? new Date().toISOString(),
    service: asString(raw.service) ?? fallback.service,
    instance: asString(raw.instance) ?? fallback.instance,
    env: asString(raw.env) ?? fallback.env,
    msg: scrubString(typeof raw.msg === 'string' ? raw.msg : '').slice(0, 4000),
    event: asString(raw.event) === null ? null : scrubString(asString(raw.event) ?? ''),
    requestId: asString(raw.requestId),
    jobId: asString(raw.jobId),
    runId: asString(raw.runId),
    targetId: asString(raw.targetId),
    context,
  };
  if (raw.err !== undefined) shaped.err = serializeErr(scrubValue(raw.err));
  if (shaped.msg.length === 0) shaped.msg = '-';
  return shaped;
}

function toInsert(row: ShapedLog): AppLogInsert {
  return {
    ts: new Date(row.time),
    level: row.level,
    service: row.service,
    instance: row.instance,
    event: row.event,
    message: row.msg,
    requestId: row.requestId,
    jobId: row.jobId,
    runId: row.runId,
    targetId: row.targetId,
    context: row.context,
  };
}

const textEncoder = new TextEncoder();
const REPORT_INTERVAL_MS = 1_000;

export function measurePersistedLogBytes(row: AppLogInsert): number {
  return textEncoder.encode(
    JSON.stringify({
      ts: row.ts.toISOString(),
      level: row.level,
      service: row.service,
      instance: row.instance,
      event: row.event,
      message: row.message,
      requestId: row.requestId,
      jobId: row.jobId,
      runId: row.runId,
      targetId: row.targetId,
      context: row.context,
    }),
  ).byteLength;
}

type PendingBatch = {
  rows: AppLogInsert[];
  bytes: number;
};

export function createLogger(options: CreateLoggerOptions): ManagedStudioLogger {
  const instance = options.instance ?? null;
  const envName = options.envName ?? process.env.NODE_ENV ?? 'development';
  const destination = options.destination ?? ((line: string) => process.stdout.write(line));
  const envLimits = readLogQueueLimits(options.limitsEnv ?? process.env);
  const maxRecords = assertBoundedInt(
    options.maxRecords ?? envLimits.maxRecords,
    1,
    LOG_QUEUE_MAX_RECORDS_CEILING,
    'maxRecords',
  );
  const maxBytes = assertBoundedInt(
    options.maxBytes ?? envLimits.maxBytes,
    1,
    LOG_QUEUE_MAX_BYTES_CEILING,
    'maxBytes',
  );
  const sink =
    options.sink === undefined
      ? options.sql
        ? createPgLogSink(options.sql, { destination, service: options.service, instance, envName })
        : null
      : options.sink;
  const queue: AppLogInsert[] = [];
  let queueBytes = 0;
  const staged: PendingBatch[] = [];
  let inFlight: PendingBatch | null = null;
  let writing = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rejectedRecords = 0;
  let rejectedBytes = 0;
  let sinkFailures = 0;
  let flushTimeouts = 0;
  let peakPendingRecords = 0;
  let peakPendingBytes = 0;
  let batchesWritten = 0;
  let batchesFailed = 0;
  let sampling = false;
  const drainWaiters: Array<() => void> = [];

  const stagedRecords = () => staged.reduce((sum, batch) => sum + batch.rows.length, 0);
  const stagedBytesTotal = () => staged.reduce((sum, batch) => sum + batch.bytes, 0);
  const pendingRecordCount = () => queue.length + stagedRecords() + (inFlight?.rows.length ?? 0);
  const pendingByteCount = () => queueBytes + stagedBytesTotal() + (inFlight?.bytes ?? 0);
  const idle = () => !writing && staged.length === 0 && queue.length === 0;

  const snapshot = (): LogQueueStats => ({
    queuedRecords: queue.length,
    stagedRecords: stagedRecords(),
    inFlightRecords: inFlight?.rows.length ?? 0,
    pendingRecords: pendingRecordCount(),
    queuedBytes: queueBytes,
    stagedBytes: stagedBytesTotal(),
    inFlightBytes: inFlight?.bytes ?? 0,
    pendingBytes: pendingByteCount(),
    maxRecords,
    maxBytes,
    rejectedRecords,
    rejectedBytes,
    sinkFailures,
    flushTimeouts,
    peakPendingRecords,
    peakPendingBytes,
    batchesWritten,
    batchesFailed,
  });

  const notePending = () => {
    const records = pendingRecordCount();
    const bytes = pendingByteCount();
    if (records > peakPendingRecords) peakPendingRecords = records;
    if (bytes > peakPendingBytes) peakPendingBytes = bytes;
    if (sampling || !options.onQueueSample) return;
    sampling = true;
    try {
      options.onQueueSample(snapshot());
    } catch {
      // observers must not break the caller
    } finally {
      sampling = false;
    }
  };

  const notifyDrain = () => {
    if (!idle()) return;
    const waiters = drainWaiters.splice(0, drainWaiters.length);
    for (const waiter of waiters) waiter();
  };

  const writeDirect = (record: {
    level: 'warn' | 'error';
    event: string;
    msg: string;
    context: Record<string, unknown>;
  }) => {
    try {
      destination(
        `${JSON.stringify({
          level: record.level,
          time: new Date().toISOString(),
          service: options.service,
          instance,
          env: envName,
          msg: record.msg,
          event: record.event,
          requestId: null,
          jobId: null,
          runId: null,
          targetId: null,
          context: record.context,
        })}\n`,
      );
    } catch {
      // stdout must not break the caller
    }
  };

  const rateLimited = (emit: (suppressed: number) => void) => {
    let last = 0;
    let suppressed = 0;
    return () => {
      const now = Date.now();
      if (last !== 0 && now - last < REPORT_INTERVAL_MS) {
        suppressed += 1;
        return;
      }
      const skipped = suppressed;
      suppressed = 0;
      last = now;
      emit(skipped);
    };
  };

  const reportOverflow = rateLimited((suppressed) => {
    writeDirect({
      level: 'warn',
      event: 'log.queue_overflow',
      msg: '日志队列已满，已拒绝新记录',
      context: {
        rejectedRecords,
        rejectedBytes,
        suppressedNotices: suppressed,
        pendingRecords: pendingRecordCount(),
        pendingBytes: pendingByteCount(),
        maxRecords,
        maxBytes,
      },
    });
  });

  const reportSinkFailure = rateLimited((suppressed) => {
    writeDirect({
      level: 'error',
      event: 'log.sink_failed',
      msg: 'app_logs 写入失败，已降级到 stdout',
      context: {
        error: scrubString(lastSinkErrorText),
        sinkFailures,
        suppressedNotices: suppressed,
      },
    });
  });

  const reportFlushTimeout = rateLimited((suppressed) => {
    writeDirect({
      level: 'error',
      event: 'log.flush_timeout',
      msg: '日志冲刷超时，未确认持久化',
      context: {
        flushTimeouts,
        suppressedNotices: suppressed,
        pendingRecords: pendingRecordCount(),
        pendingBytes: pendingByteCount(),
        inFlightRecords: inFlight?.rows.length ?? 0,
      },
    });
  });

  let lastSinkErrorText = 'app_logs sink failed';

  const pump = () => {
    if (writing || !sink) return;
    const next = staged.shift();
    if (!next) {
      notePending();
      notifyDrain();
      return;
    }
    writing = true;
    inFlight = next;
    notePending();
    let pending: Promise<void | LogSinkFailure>;
    try {
      pending = sink.write(next.rows);
    } catch (error) {
      settleWrite(true, undefined, error);
      return;
    }
    void pending.then(
      (result) => {
        settleWrite(false, result ?? undefined);
      },
      (error: unknown) => {
        settleWrite(true, undefined, error);
      },
    );
  };

  const settleWrite = (threw: boolean, result: LogSinkFailure | undefined, error?: unknown) => {
    const failed = threw || result?.ok === false;
    if (failed) {
      batchesFailed += 1;
      sinkFailures += 1;
      const reason = threw ? error : result?.error;
      lastSinkErrorText = reason instanceof Error ? reason.message : 'app_logs sink failed';
      if (!result?.reported) reportSinkFailure();
    } else {
      batchesWritten += 1;
    }
    inFlight = null;
    writing = false;
    notePending();
    notifyDrain();
    queueMicrotask(pump);
  };

  const flushQueue = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!sink || queue.length === 0) return;
    const rows = queue.splice(0, queue.length);
    const bytes = queueBytes;
    queueBytes = 0;
    staged.push({ rows, bytes });
    notePending();
    pump();
  };

  const enqueue = (row: ShapedLog) => {
    if (!sink || !shouldPersistLog(row.level, row.event)) return;
    const insert = toInsert(row);
    let bytes: number;
    try {
      bytes = measurePersistedLogBytes(insert);
    } catch {
      rejectedRecords += 1;
      rejectedBytes += maxBytes;
      reportOverflow();
      return;
    }
    if (pendingRecordCount() + 1 > maxRecords || pendingByteCount() + bytes > maxBytes) {
      rejectedRecords += 1;
      rejectedBytes += bytes;
      reportOverflow();
      return;
    }
    queue.push(insert);
    queueBytes += bytes;
    notePending();
    if (queue.length >= LOG_BATCH_RECORDS) {
      flushQueue();
      return;
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flushQueue();
    }, LOG_BATCH_DELAY_MS);
    timer.unref?.();
  };

  const armWait = () => {
    if (idle()) return { promise: Promise.resolve(), cancel: () => undefined };
    let resolveWait: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      resolveWait = () => resolve();
      drainWaiters.push(resolveWait);
    });
    return {
      promise,
      cancel: () => {
        const index = drainWaiters.indexOf(resolveWait);
        if (index >= 0) drainWaiters.splice(index, 1);
      },
    };
  };

  async function flushWithin(timeoutMs: number): Promise<LogFlushResult> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error('flush 超时必须是非负有限数字');
    }
    if (!sink) {
      return { ok: true, reason: 'no_sink', pendingRecords: 0, pendingBytes: 0 };
    }
    const writtenBefore = batchesWritten;
    const failedBefore = batchesFailed;
    flushQueue();
    if (idle() && batchesWritten === writtenBefore && batchesFailed === failedBefore) {
      return { ok: true, reason: 'empty', pendingRecords: 0, pendingBytes: 0 };
    }
    const wait = armWait();
    let timerHandle: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      wait.promise.then(() => 'drained' as const),
      new Promise<'timeout'>((resolve) => {
        timerHandle = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
    ]);
    if (timerHandle) clearTimeout(timerHandle);
    if (outcome === 'timeout') {
      wait.cancel();
      flushTimeouts += 1;
      reportFlushTimeout();
      return {
        ok: false,
        reason: 'timeout',
        pendingRecords: pendingRecordCount(),
        pendingBytes: pendingByteCount(),
      };
    }
    const failed = batchesFailed > failedBefore;
    return {
      ok: !failed,
      reason: failed ? 'sink_failed' : 'persisted',
      pendingRecords: pendingRecordCount(),
      pendingBytes: pendingByteCount(),
    };
  }

  async function flush(): Promise<void> {
    flushQueue();
    await armWait().promise;
  }

  const stream = {
    write(chunk: string) {
      let parsed: Record<string, unknown> | null = null;
      try {
        const value = JSON.parse(chunk) as unknown;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          parsed = value as Record<string, unknown>;
        }
      } catch {
        parsed = null;
      }
      const shaped = parsed
        ? shapeRecord(parsed, { service: options.service, instance, env: envName })
        : null;
      const line = shaped ? `${JSON.stringify(shaped)}\n` : `${scrubString(chunk.trim())}\n`;
      try {
        destination(line);
      } catch {
        // stdout must not break the caller
      }
      if (shaped) enqueue(shaped);
    },
  };

  const base = pino(
    {
      level: options.level ?? 'info',
      messageKey: 'msg',
      base: { service: options.service, instance, env: envName },
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
      serializers: { err: serializeErr },
    },
    stream,
  );

  function wrap(bindings: LogBindings, target: pino.Logger): ManagedStudioLogger {
    const emit = (level: LogLevel, message: string, fields?: LogFields) => {
      const context = scrubValue(fields?.context ?? {});
      target[level](
        {
          event: fields?.event,
          requestId: fields?.requestId ?? bindings.requestId,
          jobId: fields?.jobId ?? bindings.jobId,
          runId: fields?.runId ?? bindings.runId,
          targetId: fields?.targetId ?? bindings.targetId,
          context: context && typeof context === 'object' && !Array.isArray(context) ? context : {},
          err: fields?.err,
        },
        scrubString(message),
      );
    };
    return {
      child(extra) {
        return wrap({ ...bindings, ...extra }, target.child(extra));
      },
      debug(message, fields) {
        emit('debug', message, fields);
      },
      info(message, fields) {
        emit('info', message, fields);
      },
      warn(message, fields) {
        emit('warn', message, fields);
      },
      error(message, fields) {
        emit('error', message, fields);
      },
      notePersisted(level, message, fields) {
        const before = rejectedRecords;
        emit(level, message, fields);
        return rejectedRecords === before;
      },
      flush,
      flushWithin,
      stats() {
        return snapshot();
      },
    };
  }

  return wrap({}, base);
}
