import type { Sql } from '@studio/db';
import { createRealThrottleClock, type ThrottleClock } from './throttle';

/** Shared bucket for requests that are not tied to a logged-in bili account. */
export const ANONYMOUS_RATE_ACCOUNT_ID = '00000000-0000-0000-0000-000000000000';

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WINDOW_MS = 60_000;

export type RatePolicy = {
  minIntervalMs: number;
  maxJitterMs: number;
  maxPerMinute: number;
};

export type RateLimiterOptions = {
  clock?: ThrottleClock;
  random?: () => number;
};

type ReservedSql = Sql & { release(): void };

type RateRow = {
  window_started_at: Date | null;
  count: number;
  last_request_at: Date | null;
};

export function rateAccountId(accountKey: string): string {
  return ACCOUNT_ID.test(accountKey) ? accountKey : ANONYMOUS_RATE_ACCOUNT_ID;
}

function lockKey(accountId: string): string {
  return `bili-rate:${accountId}`;
}

/**
 * Cross-process request slot. Holds a session advisory lock for this account
 * while deciding, sleeping, and writing `collector_rate_state`, so two
 * processes cannot both pass the same minute cap.
 */
export async function acquireRequestSlot(
  sql: Sql,
  accountId: string,
  policy: RatePolicy,
  options: RateLimiterOptions = {},
): Promise<void> {
  if (!ACCOUNT_ID.test(accountId)) {
    throw new Error('限流账号必须是 UUID');
  }
  if (policy.maxPerMinute < 1) {
    throw new Error('每分钟上限至少为 1');
  }
  const clock = options.clock ?? createRealThrottleClock();
  const random = options.random ?? Math.random;
  const reserved = await (sql as Sql & { reserve(): Promise<ReservedSql> }).reserve();
  const key = lockKey(accountId);
  let locked = false;
  try {
    await reserved`SELECT pg_advisory_lock(hashtext(${key})::bigint)`;
    locked = true;
    for (;;) {
      const now = clock.now();
      const rows = await reserved<RateRow[]>`
        SELECT window_started_at, count, last_request_at
        FROM collector_rate_state
        WHERE account_id = ${accountId}::uuid
      `;
      const row = rows[0];
      const windowStarted = row?.window_started_at ? row.window_started_at.getTime() : null;
      const lastAt = row?.last_request_at ? row.last_request_at.getTime() : null;
      let count = Number(row?.count ?? 0);
      let windowMs = windowStarted;
      if (windowMs === null || now - windowMs >= WINDOW_MS) {
        windowMs = now;
        count = 0;
      }
      let sleepMs = 0;
      if (count >= policy.maxPerMinute) {
        sleepMs = Math.max(sleepMs, windowMs + WINDOW_MS - now);
      }
      const jitter = Math.floor(random() * (policy.maxJitterMs + 1));
      const need = policy.minIntervalMs + jitter;
      if (lastAt !== null && now - lastAt < need) {
        sleepMs = Math.max(sleepMs, need - (now - lastAt));
      }
      if (sleepMs > 0) {
        await clock.sleep(sleepMs);
        continue;
      }
      const grantedAt = clock.now();
      await reserved`
        INSERT INTO collector_rate_state (account_id, window_started_at, count, last_request_at)
        VALUES (
          ${accountId}::uuid,
          ${new Date(windowMs)},
          ${count + 1},
          ${new Date(grantedAt)}
        )
        ON CONFLICT (account_id) DO UPDATE SET
          window_started_at = EXCLUDED.window_started_at,
          count = EXCLUDED.count,
          last_request_at = EXCLUDED.last_request_at
      `;
      return;
    }
  } finally {
    if (locked) {
      await reserved`SELECT pg_advisory_unlock(hashtext(${key})::bigint)`;
    }
    reserved.release();
  }
}
