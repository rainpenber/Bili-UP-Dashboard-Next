import { scrubString } from '@studio/observability';
import type { CurrentTaskResult } from '@studio/observability';

/** Returned when a request arrives after this process has begun shutdown. */
export const httpRejected = Symbol('http-rejected');

export type ProcessWork = {
  readonly closing: boolean;
  readonly activeHttp: number;
  readonly activeBackground: number;
  failureMessage(): string | null;
  stopAccepting(): void;
  runHttp<T>(run: () => Promise<T>): Promise<T | typeof httpRejected>;
  trackBackground(task: Promise<unknown>): void;
  finish(timeoutMs: number): Promise<CurrentTaskResult>;
};

/**
 * Tracks HTTP calls this process already accepted and the in-process background
 * work those calls register. The set is live: a task registered after shutdown
 * starts is still part of this shutdown. Settled work drops its reference.
 * A rejection that settled before shutdown does not fail a later finish.
 */
export function createProcessWork(): ProcessWork {
  const http = new Set<symbol>();
  const background = new Set<Promise<void>>();
  let closing = false;
  let generation = 0;
  let failure: string | null = null;
  const waiters = new Set<() => void>();

  const pulse = () => {
    generation += 1;
    for (const waiter of waiters) waiter();
    waiters.clear();
  };

  const noteFailure = (error: unknown) => {
    if (!closing || failure) return;
    const raw = error instanceof Error ? error.message : 'background failed';
    failure = scrubString(raw);
  };

  const waitForChange = (seen: number, timeoutMs: number) => {
    if (generation !== seen || timeoutMs <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(wake);
        resolve();
      }, timeoutMs);
      const wake = () => {
        clearTimeout(timer);
        resolve();
      };
      waiters.add(wake);
    });
  };

  return {
    get closing() {
      return closing;
    },
    get activeHttp() {
      return http.size;
    },
    get activeBackground() {
      return background.size;
    },
    failureMessage() {
      return failure;
    },
    stopAccepting() {
      closing = true;
      pulse();
    },
    async runHttp<T>(run: () => Promise<T>): Promise<T | typeof httpRejected> {
      if (closing) return httpRejected;
      const token = Symbol('http');
      http.add(token);
      pulse();
      try {
        return await run();
      } finally {
        http.delete(token);
        pulse();
      }
    },
    trackBackground(task: Promise<unknown>) {
      const tracked = task.then(
        () => undefined,
        (error: unknown) => {
          noteFailure(error);
        },
      );
      background.add(tracked);
      pulse();
      void tracked.finally(() => {
        background.delete(tracked);
        pulse();
      });
    },
    async finish(timeoutMs: number): Promise<CurrentTaskResult> {
      const budget = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
      const deadline = Date.now() + budget;
      while (http.size > 0 || background.size > 0) {
        const left = deadline - Date.now();
        if (left <= 0) return failure ? 'failed' : 'timed_out';
        const seen = generation;
        await waitForChange(seen, left);
      }
      return failure ? 'failed' : 'finished';
    },
  };
}
