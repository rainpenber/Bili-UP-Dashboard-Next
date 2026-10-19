import {
  parseOpsDebugBundle,
  parseOpsHealth,
  parseOpsLog,
  parseOpsPage,
  parseOpsRun,
  parseOpsRunDetail,
  parseOpsSummary,
  type OpsDebugBundle,
  type OpsHealth,
  type OpsLog,
  type OpsPage,
  type OpsRun,
  type OpsRunDetail,
  type OpsSummary,
} from '@studio/contracts';

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.length > 0) return body.error;
  } catch {
    // fall through
  }
  return `HTTP ${response.status}`;
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const init: RequestInit = { headers: { accept: 'application/json' } };
  if (signal) init.signal = signal;
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<unknown>;
}

export function fetchOpsSummary(signal?: AbortSignal): Promise<OpsSummary> {
  return getJson('/api/v1/ops/summary', signal).then(parseOpsSummary);
}

export function fetchOpsHealth(signal?: AbortSignal): Promise<OpsHealth> {
  return getJson('/api/v1/ops/health', signal).then(parseOpsHealth);
}

export function fetchOpsRuns(
  query: { status?: string; targetId?: string; since?: string; until?: string },
  signal?: AbortSignal,
): Promise<OpsPage<OpsRun>> {
  const params = new URLSearchParams({ limit: '50' });
  if (query.status) params.set('status', query.status);
  if (query.targetId) params.set('targetId', query.targetId);
  if (query.since) params.set('since', query.since);
  if (query.until) params.set('until', query.until);
  return getJson(`/api/v1/ops/runs?${params.toString()}`, signal).then((body) =>
    parseOpsPage(body, parseOpsRun, 'runs'),
  );
}

export function fetchOpsRun(runId: string, signal?: AbortSignal): Promise<OpsRunDetail> {
  return getJson(`/api/v1/ops/runs/${runId}`, signal).then(parseOpsRunDetail);
}

export function fetchOpsLogs(
  query: { level?: string; service?: string; q?: string; runId?: string },
  signal?: AbortSignal,
): Promise<OpsPage<OpsLog>> {
  const params = new URLSearchParams({ limit: '200' });
  if (query.level) params.set('level', query.level);
  if (query.service) params.set('service', query.service);
  if (query.q) params.set('q', query.q);
  if (query.runId) params.set('runId', query.runId);
  return getJson(`/api/v1/ops/logs?${params.toString()}`, signal).then((body) =>
    parseOpsPage(body, parseOpsLog, 'logs'),
  );
}

export function fetchOpsDebugBundle(runId: string): Promise<OpsDebugBundle> {
  return getJson(`/api/v1/ops/debug/bundle?runId=${encodeURIComponent(runId)}`).then(
    parseOpsDebugBundle,
  );
}
