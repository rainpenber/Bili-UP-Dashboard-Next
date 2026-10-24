import {
  parseOpsCollectorJobDetail,
  parseOpsCollectorJobGroups,
  parseOpsCollectorJobList,
  parseOpsCollectorTargetSearch,
  parseOpsDebugBundle,
  parseOpsHealth,
  parseOpsLog,
  parseOpsOperationList,
  parseOpsPage,
  parseOpsProjectSearch,
  parseOpsRun,
  parseOpsRunDetail,
  parseOpsSummary,
  type OpsCollectorJobDetail,
  type OpsCollectorJobGroups,
  type OpsCollectorJobList,
  type OpsCollectorTargetSearch,
  type OpsDebugBundle,
  type OpsHealth,
  type OpsLog,
  type OpsOperationList,
  type OpsPage,
  type OpsProjectSearch,
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
  query: {
    level?: string | undefined;
    service?: string | undefined;
    q?: string | undefined;
    runId?: string | undefined;
    targetId?: string | undefined;
    since?: string | undefined;
    until?: string | undefined;
    attention?: boolean | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  },
  signal?: AbortSignal,
): Promise<OpsPage<OpsLog> & { total: number }> {
  const params = new URLSearchParams({ limit: String(query.limit ?? 50) });
  if (query.level) params.set('level', query.level);
  if (query.service) params.set('service', query.service);
  if (query.q) params.set('q', query.q);
  if (query.runId) params.set('runId', query.runId);
  if (query.targetId) params.set('targetId', query.targetId);
  if (query.since) params.set('since', query.since);
  if (query.until) params.set('until', query.until);
  if (query.attention) params.set('attention', '1');
  if (query.cursor) params.set('cursor', query.cursor);
  return getJson(`/api/v1/ops/logs?${params.toString()}`, signal).then((body) => {
    const page = parseOpsPage(body, parseOpsLog, 'logs');
    const total = (body as { total?: unknown }).total;
    if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
      throw new Error('total must be a non-negative integer');
    }
    return { ...page, total };
  });
}

export type OpsJobQuery = {
  type?: string | undefined;
  targetId?: string | undefined;
  externalId?: string | undefined;
  q?: string | undefined;
  status?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  projectId?: string | undefined;
  group?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  jobsPerGroup?: number | undefined;
};

function jobParams(query: OpsJobQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.targetId) params.set('targetId', query.targetId);
  if (query.externalId) params.set('externalId', query.externalId);
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.since) params.set('since', query.since);
  if (query.until) params.set('until', query.until);
  if (query.projectId) params.set('projectId', query.projectId);
  if (query.group) params.set('group', query.group);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.jobsPerGroup) params.set('jobsPerGroup', String(query.jobsPerGroup));
  return params;
}

export function fetchOpsCollectorJobs(
  query: OpsJobQuery,
  signal?: AbortSignal,
): Promise<OpsCollectorJobList | OpsCollectorJobGroups> {
  const params = jobParams(query);
  return getJson(`/api/v1/ops/collector-jobs?${params.toString()}`, signal).then((body) => {
    const mode = (body as { mode?: unknown }).mode;
    if (mode === 'target') return parseOpsCollectorJobGroups(body);
    return parseOpsCollectorJobList(body);
  });
}

export function fetchOpsCollectorJob(
  jobId: string,
  query: { attemptPage?: number; attemptPageSize?: number },
  signal?: AbortSignal,
): Promise<OpsCollectorJobDetail> {
  const params = new URLSearchParams();
  if (query.attemptPage) params.set('attemptPage', String(query.attemptPage));
  if (query.attemptPageSize) params.set('attemptPageSize', String(query.attemptPageSize));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return getJson(`/api/v1/ops/collector-jobs/${jobId}${suffix}`, signal).then(
    parseOpsCollectorJobDetail,
  );
}

export function fetchOpsCollectorTargets(
  query: { q: string; type?: string | undefined },
  signal?: AbortSignal,
): Promise<OpsCollectorTargetSearch> {
  const params = new URLSearchParams({ q: query.q, limit: '20' });
  if (query.type) params.set('type', query.type);
  return getJson(`/api/v1/ops/collector-targets?${params.toString()}`, signal).then(
    parseOpsCollectorTargetSearch,
  );
}

export function fetchOpsProjects(q: string, signal?: AbortSignal): Promise<OpsProjectSearch> {
  const params = new URLSearchParams({ q, limit: '20' });
  return getJson(`/api/v1/ops/projects?${params.toString()}`, signal).then(parseOpsProjectSearch);
}

export function fetchOpsOperations(
  query: {
    targetId?: string | undefined;
    action?: string | undefined;
    since?: string | undefined;
    until?: string | undefined;
    requestId?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
  },
  signal?: AbortSignal,
): Promise<OpsOperationList> {
  const params = new URLSearchParams();
  if (query.targetId) params.set('targetId', query.targetId);
  if (query.action) params.set('action', query.action);
  if (query.since) params.set('since', query.since);
  if (query.until) params.set('until', query.until);
  if (query.requestId) params.set('requestId', query.requestId);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  return getJson(`/api/v1/ops/operations?${params.toString()}`, signal).then(parseOpsOperationList);
}

export function fetchOpsDebugBundle(runId: string): Promise<OpsDebugBundle> {
  return getJson(`/api/v1/ops/debug/bundle?runId=${encodeURIComponent(runId)}`).then(
    parseOpsDebugBundle,
  );
}
