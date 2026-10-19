import {
  parseCommercialDefaultTemplate,
  parseCommercialNodeWriteResponse,
  parseCommercialProjectDetail,
  parseCommercialProjectList,
  parseCommercialProjectWorkflow,
  parseCommercialStepResponse,
  parseCommercialWriteError,
  type CommercialDefaultTemplate,
  type CommercialNodeWriteResponse,
  type CommercialProjectDetail,
  type CommercialProjectListResponse,
  type CommercialProjectWorkflow,
  type CommercialStepPublish,
  type CommercialStageStepToken,
  type CommercialWriteErrorBody,
} from '@studio/contracts';

export class CommercialReadError extends Error {
  readonly status: number;
  readonly kind: 'http' | 'parse';

  constructor(message: string, status: number, kind: 'http' | 'parse') {
    super(message);
    this.name = 'CommercialReadError';
    this.status = status;
    this.kind = kind;
  }
}

export function retryCommercialRead(failureCount: number, error: unknown): boolean {
  return error instanceof CommercialReadError && error.status >= 500 && failureCount < 1;
}

async function getJson(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path);
  } catch (err) {
    throw new CommercialReadError(err instanceof Error ? err.message : '网络异常', 0, 'http');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new CommercialReadError(body.error ?? `HTTP ${res.status}`, res.status, 'http');
  }
  return res.json();
}

function parseRead<T>(parse: (value: unknown) => T, value: unknown): T {
  try {
    return parse(value);
  } catch (err) {
    throw new CommercialReadError(
      err instanceof Error ? err.message : '响应无法解析',
      200,
      'parse',
    );
  }
}

export function fetchLiveProjectList(): Promise<CommercialProjectListResponse> {
  return getJson('/api/v1/commercial/projects').then((body) =>
    parseRead(parseCommercialProjectList, body),
  );
}

export function fetchLiveProjectDetail(projectId: string): Promise<CommercialProjectDetail> {
  return getJson(`/api/v1/commercial/projects/${encodeURIComponent(projectId)}`).then((body) =>
    parseRead(parseCommercialProjectDetail, body),
  );
}

export function fetchLiveProjectWorkflow(projectId: string): Promise<CommercialProjectWorkflow> {
  return getJson(`/api/v1/commercial/projects/${encodeURIComponent(projectId)}/workflow`).then(
    (body) => parseRead(parseCommercialProjectWorkflow, body),
  );
}

export async function saveLiveNodePlan(
  projectId: string,
  nodeId: string,
  body: { expectedUpdatedAt: string; plannedAt: string | null },
): Promise<CommercialNodeWriteResponse> {
  const res = await fetch(
    `/api/v1/commercial/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/plan`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return parseCommercialNodeWriteResponse(payload);
}

export type LiveStepResult =
  { ok: true } | { ok: false; status: number; body: CommercialWriteErrorBody };

async function postStep(path: string, body: unknown): Promise<LiveStepResult> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    try {
      return { ok: false, status: res.status, body: parseCommercialWriteError(payload) };
    } catch {
      const message =
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${res.status}`;
      return { ok: false, status: res.status, body: { error: message, code: 'invalid_body' } };
    }
  }
  parseCommercialStepResponse(payload);
  return { ok: true };
}

export function postLiveNodeStep(
  projectId: string,
  nodeId: string,
  body: {
    expectedUpdatedAt: string;
    direction: 'forward' | 'rollback';
    force?: boolean;
    publish?: CommercialStepPublish | null;
  },
): Promise<LiveStepResult> {
  return postStep(
    `/api/v1/commercial/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/step`,
    body,
  );
}

export function postLiveStageStep(
  projectId: string,
  stageId: string,
  body: {
    direction: 'forward' | 'rollback';
    tokens: CommercialStageStepToken[];
    force?: boolean;
    publish?: CommercialStepPublish | null;
  },
): Promise<LiveStepResult> {
  return postStep(
    `/api/v1/commercial/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}/step`,
    body,
  );
}

export function fetchLiveDefaultTemplate(): Promise<CommercialDefaultTemplate> {
  return getJson('/api/v1/commercial/templates/default').then((body) =>
    parseRead(parseCommercialDefaultTemplate, body),
  );
}
