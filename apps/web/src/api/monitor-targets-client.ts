import {
  parseCollectorJobList,
  parseMonitorTarget,
  parseMonitorTargetCreateResponse,
  parseMonitorTargetList,
  parseMonitorTargetRunResponse,
  type CollectorJob,
  type MonitorTarget,
  type MonitorTargetCreateResponse,
  type MonitorTargetPatchRequest,
  type MonitorTargetType,
  type Paginated,
} from '@studio/contracts';

const API_BASE = import.meta.env.VITE_MONITOR_API_BASE ?? '/api/v1/monitor';

export class MonitorRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'MonitorRequestError';
    this.status = status;
    this.code = code;
  }
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    throw new MonitorRequestError(
      body.error ?? `HTTP ${res.status}`,
      res.status,
      body.code ?? null,
    );
  }
  return body;
}

export function fetchMonitorTargets(page = 1): Promise<Paginated<MonitorTarget>> {
  return requestJson(`/targets?page=${page}&pageSize=8`).then(parseMonitorTargetList);
}

export function fetchMonitorTargetByIdentity(
  type: MonitorTargetType,
  externalId: string,
): Promise<MonitorTarget | null> {
  return requestJson(
    `/targets/of/${encodeURIComponent(type)}/${encodeURIComponent(externalId)}`,
  )
    .then((body) => {
      if (typeof body !== 'object' || body === null || !('target' in body)) {
        throw new MonitorRequestError('监控项响应不完整', 500, null);
      }
      return parseMonitorTarget((body as { target: unknown }).target);
    })
    .catch((error) => {
      if (error instanceof MonitorRequestError && error.status === 404) return null;
      throw error;
    });
}

export function fetchMonitorJobs(page = 1): Promise<Paginated<CollectorJob>> {
  return requestJson(`/jobs?page=${page}&pageSize=8`).then(parseCollectorJobList);
}

export function createMonitorTarget(input: {
  type: MonitorTargetType;
  externalId: string;
  label?: string;
  tags?: string[];
  intervalMode?: 'auto' | 'fixed';
  intervalMinutes?: number;
  /** Video-only planned first collect; omit for immediate start. */
  startAt?: string | null;
}): Promise<MonitorTargetCreateResponse> {
  const body: Record<string, unknown> = {
    type: input.type,
    externalId: input.externalId,
  };
  if (input.label !== undefined) body.label = input.label;
  if (input.tags !== undefined) body.tags = input.tags;
  if (input.intervalMode) body.intervalMode = input.intervalMode;
  if (input.intervalMinutes !== undefined) body.intervalMinutes = input.intervalMinutes;
  if (input.startAt !== undefined) body.startAt = input.startAt;
  return requestJson('/targets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(parseMonitorTargetCreateResponse);
}

export function patchMonitorTarget(
  id: string,
  patch: MonitorTargetPatchRequest,
): Promise<{ target: MonitorTarget }> {
  return requestJson(`/targets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((body) => {
    if (typeof body !== 'object' || body === null || !('target' in body)) {
      throw new MonitorRequestError('监控项响应不完整', 500, null);
    }
    return { target: parseMonitorTarget(body.target) };
  });
}

export function deleteMonitorTarget(id: string): Promise<void> {
  return requestJson(`/targets/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
    () => undefined,
  );
}

export function runMonitorTarget(id: string): Promise<{ job: CollectorJob; message: string }> {
  return requestJson(`/targets/${encodeURIComponent(id)}/run`, { method: 'POST' }).then((body) => {
    const parsed = parseMonitorTargetRunResponse(body);
    return { job: parsed.job, message: parsed.message };
  });
}
