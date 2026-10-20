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

type RateRow = {
  window_started_at: Date | string | null;
  count: number | string;
  last_request_at: Date | string | null;
};

function toMillis(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(millis)) throw new Error('限流时间无法解析');
  return millis;
}

export function rateAccountId(accountKey: string): string {
  return ACCOUNT_ID.test(accountKey) ? accountKey : ANONYMOUS_RATE_ACCOUNT_ID;
}

function lockKey(accountId: string): string {
  return `bili-rate:${accountId}`;
}

/**
 * Cross-process request slot.
 *
 * The next allowed timestamp is written inside a transaction that also holds
 * `pg_advisory_xact_lock`. That lock is released only when the transaction
 * commits, so the following request cannot read a stale `last_request_at`.
 * Sleep happens after the commit, before the HTTP call.
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
  const key = lockKey(accountId);
  const grantAt = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
    const now = clock.now();
    const rows = await tx<RateRow[]>`
      SELECT window_started_at, count, last_request_at
      FROM collector_rate_state
      WHERE account_id = ${accountId}::uuid
    `;
    const row = rows[0];
    const jitter = Math.floor(random() * (policy.maxJitterMs + 1));
    const need = policy.minIntervalMs + jitter;
    const lastAt = toMillis(row?.last_request_at);
    let windowMs = toMillis(row?.window_started_at);
    let count = Number(row?.count ?? 0);
    let nextAt = now;
    if (lastAt !== null) nextAt = Math.max(nextAt, lastAt + need);
    if (windowMs === null || nextAt - windowMs >= WINDOW_MS) {
      windowMs = nextAt;
      count = 0;
    }
    if (count >= policy.maxPerMinute) {
      nextAt = Math.max(nextAt, windowMs + WINDOW_MS);
      windowMs = nextAt;
      count = 0;
    }
    await tx`
      INSERT INTO collector_rate_state (account_id, window_started_at, count, last_request_at)
      VALUES (
        ${accountId}::uuid,
        ${new Date(windowMs)},
        ${count + 1},
        ${new Date(nextAt)}
      )
      ON CONFLICT (account_id) DO UPDATE SET
        window_started_at = EXCLUDED.window_started_at,
        count = EXCLUDED.count,
        last_request_at = EXCLUDED.last_request_at
    `;
    return nextAt;
  });
  const delay = grantAt - clock.now();
  if (delay > 0) await clock.sleep(delay);
}
