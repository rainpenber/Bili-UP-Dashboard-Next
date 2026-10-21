/**
 * app_logs write policy:
 * - warn and error are stored in full
 * - info is stored only for this lifecycle whitelist
 * - debug is stdout only
 * http.request is intentionally absent: access lines stay on stdout.
 */
export const PERSISTED_INFO_EVENTS = [
  'job.claimed',
  'job.succeeded',
  'job.failed',
  'circuit.open',
  'circuit.close',
  'backfill.started',
  'backfill.finished',
  'backfill.aborted',
  'backfill.item_failed',
  'import.webui.started',
  'import.webui.finished',
  'auth.login',
  'service.started',
  'service.stopped',
  'legacy.sync.started',
  'legacy.sync.finished',
  'legacy.sync.failed',
  'monitor.target.created',
  'monitor.target.paused',
  'monitor.target.resumed',
  'monitor.target.interval',
  'monitor.target.renamed',
  'monitor.target.tags',
  'monitor.target.removed',
  'monitor.target.run',
  'monitor.target.reschedule',
] as const;

export type PersistedInfoEvent = (typeof PERSISTED_INFO_EVENTS)[number];

const PERSISTED_INFO = new Set<string>(PERSISTED_INFO_EVENTS);

export function shouldPersistLog(level: string, event: string | null): boolean {
  if (level === 'warn' || level === 'error' || level === 'fatal') return true;
  if (level === 'info' && event !== null && PERSISTED_INFO.has(event)) return true;
  return false;
}
