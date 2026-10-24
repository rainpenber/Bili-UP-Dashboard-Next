import type { Sql } from '@studio/db';
import { scrubString } from './redact';

export const APP_LOG_RETENTION_DAYS = 14;
export const APP_LOG_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function readRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.APP_LOG_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === '') return APP_LOG_RETENTION_DAYS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new Error('APP_LOG_RETENTION_DAYS 超出范围');
  }
  return value;
}

export async function pruneAppLogs(
  sql: Sql,
  options: { retentionDays?: number; now?: Date } = {},
): Promise<number> {
  const days = options.retentionDays ?? APP_LOG_RETENTION_DAYS;
  if (!Number.isInteger(days) || days < 1) throw new Error('retentionDays 必须是正整数');
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rows = await sql<{ id: string }[]>`
    DELETE FROM app_logs
    WHERE ts < ${cutoff}
    RETURNING id::text AS id
  `;
  return rows.length;
}

export function startAppLogRetention(
  sql: Sql,
  options: {
    retentionDays?: number;
    intervalMs?: number;
    onError?: (message: string) => void;
  } = {},
): () => void {
  const retentionDays = options.retentionDays ?? readRetentionDays();
  const intervalMs = options.intervalMs ?? APP_LOG_RETENTION_INTERVAL_MS;
  const run = () => {
    void pruneAppLogs(sql, { retentionDays }).catch((error: unknown) => {
      const message = scrubString(error instanceof Error ? error.message : 'app_logs prune failed');
      options.onError?.(message);
    });
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
