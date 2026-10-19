export type BilibiliRuntimeConfig = {
  minIntervalMs: number;
  maxJitterMs: number;
  maxPerMinute: number;
  timeoutMs: number;
  dryRun: boolean;
  forcedAccountId: string | null;
  anonymousMinIntervalMs: number;
};

function readInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`采集器配置超出范围: ${raw}`);
  }
  return value;
}

export function readBilibiliRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): BilibiliRuntimeConfig {
  const forced = env.COLLECTOR_ACCOUNT_ID?.trim() ?? '';
  return {
    minIntervalMs: readInt(env.COLLECTOR_MIN_INTERVAL_MS, 1500, 0, 600_000),
    maxJitterMs: readInt(env.COLLECTOR_MAX_JITTER_MS, 800, 0, 600_000),
    maxPerMinute: readInt(env.COLLECTOR_MAX_REQUESTS_PER_MINUTE, 20, 1, 600),
    timeoutMs: readInt(env.COLLECTOR_HTTP_TIMEOUT_MS, 10_000, 100, 120_000),
    dryRun: env.COLLECTOR_DRY_RUN === '1',
    forcedAccountId: forced.length > 0 ? forced : null,
    anonymousMinIntervalMs: 5_000,
  };
}
