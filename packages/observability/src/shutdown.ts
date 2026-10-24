import { scrubString } from './redact';
import type { ShutdownBudgets } from './limits';

export type CurrentTaskResult = 'finished' | 'timed_out' | 'failed';

export type LogFlushResult = {
  ok: boolean;
  reason: 'persisted' | 'empty' | 'no_sink' | 'sink_failed' | 'timeout';
  pendingRecords: number;
  pendingBytes: number;
};

export type ShutdownHooks = {
  stopAccepting: () => void;
  finishCurrent: (timeoutMs: number) => Promise<CurrentTaskResult>;
  /** True when this shutdown's stop event was accepted into the bounded queue. */
  recordStopped: () => boolean;
  flush: (timeoutMs: number) => Promise<LogFlushResult>;
  stopRetention: () => void;
  closeResources: (timeoutMs: number) => Promise<void>;
};

export type ShutdownDiagnostic = {
  level: 'info' | 'warn' | 'error';
  event: string;
  msg: string;
  context: Record<string, unknown>;
};

export type ShutdownController = {
  readonly started: boolean;
  start(signal: string): Promise<number>;
  /** Await an in-flight shutdown, or start one if the caller is the normal exit path. */
  join(reason: string): Promise<number>;
};

const SCHEDULE_MARGIN_MS = 50;

function raceTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  if (timeoutMs <= 0) {
    void promise.then(
      () => undefined,
      () => undefined,
    );
    return Promise.resolve(fallback);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export function createShutdownController(options: {
  budgets: ShutdownBudgets;
  hooks: ShutdownHooks;
  writeDiagnostic: (record: ShutdownDiagnostic) => void;
  now?: () => number;
  exit?: (code: number) => void;
}): ShutdownController {
  const now = options.now ?? (() => Date.now());
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let started = false;
  let run: Promise<number> | null = null;
  let duplicateNoticeAt = 0;

  const diagnose = (record: ShutdownDiagnostic) => {
    const context: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record.context)) {
      context[key] = typeof value === 'string' ? scrubString(value) : value;
    }
    try {
      options.writeDiagnostic({ ...record, msg: scrubString(record.msg), context });
    } catch {
      // diagnostics must not block shutdown
    }
  };

  return {
    get started() {
      return started;
    },
    start(signal: string): Promise<number> {
      if (started && run) {
        const at = now();
        if (duplicateNoticeAt === 0 || at - duplicateNoticeAt >= 1_000) {
          duplicateNoticeAt = at;
          diagnose({
            level: 'warn',
            event: 'process.signal_duplicate',
            msg: '重复终止信号已忽略',
            context: { signal },
          });
        }
        return run;
      }
      return begin(signal);
    },
    join(reason: string): Promise<number> {
      if (run) return run;
      return begin(reason);
    },
  };

  function begin(signal: string): Promise<number> {
    if (run) return run;
    started = true;
    const begun = now();
    let finished = false;
    const hard = setTimeout(() => {
      if (finished) return;
      finished = true;
      diagnose({
        level: 'error',
        event: 'process.exit_budget_exceeded',
        msg: '进程退出预算耗尽，日志冲刷未完成',
        context: {
          signal,
          flushCompleted: false,
          elapsedMs: now() - begun,
          budgetMs: options.budgets.exitMs,
        },
      });
      exit(2);
    }, options.budgets.exitMs);

    const remaining = () =>
      Math.max(0, options.budgets.exitMs - (now() - begun) - SCHEDULE_MARGIN_MS);

    run = (async () => {
      let code = 1;
      try {
        options.hooks.stopAccepting();
        const taskBudget = Math.max(0, remaining() - options.budgets.flushMs);
        const task = await raceTimeout(
          options.hooks.finishCurrent(taskBudget),
          taskBudget,
          'timed_out' as const,
        );
        let stopAccepted = false;
        try {
          stopAccepted = options.hooks.recordStopped();
        } catch (error) {
          diagnose({
            level: 'error',
            event: 'process.stop_event_failed',
            msg: '停止事件写入失败',
            context: {
              error: error instanceof Error ? error.message : 'stop event failed',
            },
          });
        }
        const flushBudget = Math.min(options.budgets.flushMs, remaining());
        const timeoutResult: LogFlushResult = {
          ok: false,
          reason: 'timeout',
          pendingRecords: -1,
          pendingBytes: -1,
        };
        let flushed = await raceTimeout(
          options.hooks.flush(flushBudget),
          flushBudget,
          timeoutResult,
        );
        if (!stopAccepted) {
          try {
            stopAccepted = options.hooks.recordStopped();
          } catch (error) {
            diagnose({
              level: 'error',
              event: 'process.stop_event_failed',
              msg: '停止事件写入失败',
              context: {
                error: error instanceof Error ? error.message : 'stop event failed',
              },
            });
          }
          if (stopAccepted) {
            const againBudget = Math.min(options.budgets.flushMs, remaining());
            const again = await raceTimeout(
              options.hooks.flush(againBudget),
              againBudget,
              timeoutResult,
            );
            flushed = {
              ok: flushed.ok && again.ok,
              reason: again.ok ? flushed.reason : again.reason,
              pendingRecords: again.pendingRecords,
              pendingBytes: again.pendingBytes,
            };
          }
        }
        try {
          options.hooks.stopRetention();
        } catch (error) {
          diagnose({
            level: 'error',
            event: 'process.retention_stop_failed',
            msg: '停止日志清理失败',
            context: {
              error: error instanceof Error ? error.message : 'retention stop failed',
            },
          });
        }
        const closeBudget = remaining();
        await raceTimeout(options.hooks.closeResources(closeBudget), closeBudget, undefined);
        const complete = task === 'finished' && flushed.ok && stopAccepted;
        code = complete ? 0 : 1;
        if (!complete) {
          diagnose({
            level: 'error',
            event: 'process.shutdown_incomplete',
            msg: '进程停止未完整成功',
            context: {
              signal,
              task,
              stopEventAccepted: stopAccepted,
              flushOk: flushed.ok,
              flushReason: flushed.reason,
              pendingRecords: flushed.pendingRecords,
              pendingBytes: flushed.pendingBytes,
            },
          });
        }
      } catch (error) {
        code = 1;
        diagnose({
          level: 'error',
          event: 'process.shutdown_failed',
          msg: '进程停止失败',
          context: {
            signal,
            error: error instanceof Error ? error.message : 'shutdown failed',
          },
        });
      } finally {
        finished = true;
        clearTimeout(hard);
      }
      exit(code);
      return code;
    })();
    return run;
  }
}

export async function closeSqlWithin(
  sql: { end: (options?: { timeout?: number }) => Promise<unknown> },
  timeoutMs: number,
): Promise<void> {
  const seconds = Math.max(1, Math.ceil(Math.max(timeoutMs, 0) / 1000));
  await raceTimeout(
    sql.end({ timeout: seconds }).then(() => undefined),
    Math.max(0, timeoutMs),
    undefined,
  );
}
