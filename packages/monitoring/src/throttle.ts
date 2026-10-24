export type ThrottleClock = {
  now(): number;
  sleep(ms: number): Promise<void>;
};

type Bucket = {
  lastAt: number;
  stamps: number[];
};

export function createRealThrottleClock(): ThrottleClock {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function createAccountThrottle(options: {
  minIntervalMs: number;
  maxJitterMs: number;
  maxPerMinute: number;
  random?: () => number;
  clock?: ThrottleClock;
}): { wait(accountKey: string, minIntervalMs?: number): Promise<void> } {
  const random = options.random ?? Math.random;
  const clock = options.clock ?? createRealThrottleClock();
  const buckets = new Map<string, Bucket>();
  const tails = new Map<string, Promise<void>>();

  async function acquire(accountKey: string, minIntervalMs: number): Promise<void> {
    const bucket = buckets.get(accountKey) ?? { lastAt: Number.NEGATIVE_INFINITY, stamps: [] };
    for (;;) {
      const now = clock.now();
      bucket.stamps = bucket.stamps.filter((stamp) => now - stamp < 60_000);
      let sleepMs = 0;
      const oldest = bucket.stamps[0];
      if (bucket.stamps.length >= options.maxPerMinute && oldest !== undefined) {
        sleepMs = Math.max(sleepMs, 60_000 - (now - oldest));
      }
      const jitter = Math.floor(random() * (options.maxJitterMs + 1));
      const need = minIntervalMs + jitter;
      const since = now - bucket.lastAt;
      if (since < need) sleepMs = Math.max(sleepMs, need - since);
      if (sleepMs <= 0) {
        const at = clock.now();
        bucket.lastAt = at;
        bucket.stamps.push(at);
        buckets.set(accountKey, bucket);
        return;
      }
      await clock.sleep(sleepMs);
    }
  }

  return {
    wait(accountKey: string, minIntervalMs = options.minIntervalMs): Promise<void> {
      const previous = tails.get(accountKey) ?? Promise.resolve();
      const run = previous.then(() => acquire(accountKey, minIntervalMs));
      tails.set(
        accountKey,
        run.then(
          () => undefined,
          () => undefined,
        ),
      );
      return run;
    },
  };
}
