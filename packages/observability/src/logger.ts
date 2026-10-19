import pino from 'pino';
import type { Sql } from '@studio/db';
import { shouldPersistLog } from './policy';
import { REDACT_PATHS, scrubString, scrubValue } from './redact';
import { createPgLogSink, type AppLogInsert, type LogSink } from './pg-sink';

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

export type StudioLogger = {
  child(bindings: LogBindings): StudioLogger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  flush(): Promise<void>;
};

export type CreateLoggerOptions = {
  service: 'api' | 'collector';
  instance?: string | null;
  envName?: string;
  level?: LogLevel;
  destination?: (line: string) => void;
  sink?: LogSink | null;
  sql?: Sql;
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

export function createLogger(options: CreateLoggerOptions): StudioLogger {
  const instance = options.instance ?? null;
  const envName = options.envName ?? process.env.NODE_ENV ?? 'development';
  const destination = options.destination ?? ((line: string) => process.stdout.write(line));
  const sink =
    options.sink === undefined
      ? options.sql
        ? createPgLogSink(options.sql, { destination, service: options.service, instance, envName })
        : null
      : options.sink;
  const queue: AppLogInsert[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain = Promise.resolve();

  const flushQueue = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const batch = queue.splice(0, queue.length);
    if (!sink || batch.length === 0) return;
    chain = chain
      .then(() => sink.write(batch))
      .catch((error: unknown) => {
        try {
          destination(
            `${JSON.stringify({
              level: 'error',
              time: new Date().toISOString(),
              service: options.service,
              instance,
              env: envName,
              msg: 'app_logs 写入失败，已降级到 stdout',
              event: 'log.sink_failed',
              requestId: null,
              jobId: null,
              runId: null,
              targetId: null,
              context: {
                error: scrubString(error instanceof Error ? error.message : 'app_logs sink failed'),
              },
            })}\n`,
          );
        } catch {
          // stdout must not break the caller
        }
      });
  };

  const enqueue = (row: ShapedLog) => {
    if (!sink || !shouldPersistLog(row.level, row.event)) return;
    queue.push(toInsert(row));
    if (queue.length >= 20) {
      flushQueue();
      return;
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flushQueue();
    }, 250);
    timer.unref?.();
  };

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

  function wrap(bindings: LogBindings, target: pino.Logger): StudioLogger {
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
      async flush() {
        flushQueue();
        await chain;
      },
    };
  }

  return wrap({}, base);
}
