import { scrubString } from '@studio/observability';
import type { CurrentTaskResult } from '@studio/observability';

/** Returned when a request arrives after this process has begun shutdown. */
export const httpRejected = Symbol('http-rejected');

export type ProcessWork = {
  readonly closing: boolean;
  readonly activeHttp: number;
  readonly activeBackground: number;
  failureMessage(): string | null;
  /** Responses Bun has not finished sending. Zero when no server is listening. */
  inflightNetwork(): number;
  stopAccepting(): void;
  runHttp<T>(run: () => Promise<T>): Promise<T | typeof httpRejected>;
  trackBackground(task: Promise<unknown>): void;
  finish(timeoutMs: number): Promise<CurrentTaskResult>;
};

/**
 * Tracks HTTP calls this process already accepted, the in-process background
 * work those calls register, and responses Bun has not finished sending.
 * The set is live: a task registered after shutdown starts is still part of
 * this shutdown. Handler return is not send completion. Settled work drops
 * its reference. A rejection that settled before shutdown does not fail a
 * later finish.
 */
const SEND_POLL_MS = 15;

export function createProcessWork(options?: { inflightNetwork?: () => number }): ProcessWork {
  const network = options?.inflightNetwork ?? (() => 0);
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
    inflightNetwork() {
      return network();
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
      const busy = () => http.size > 0 || background.size > 0 || network() > 0;
      while (busy()) {
        const left = deadline - Date.now();
        if (left <= 0) return failure ? 'failed' : 'timed_out';
        const seen = generation;
        const slice = network() > 0 ? Math.min(left, SEND_POLL_MS) : left;
        await waitForChange(seen, slice);
      }
      return failure ? 'failed' : 'finished';
    },
  };
}
