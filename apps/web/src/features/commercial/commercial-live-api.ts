import {
  parseCommercialDefaultTemplate,
  parseCommercialNodeWriteResponse,
  parseCommercialOpenItemCreateRequest,
  parseCommercialOpenItemUpdateRequest,
  parseCommercialOpenItemWriteResponse,
  parseCommercialProjectArchiveResponse,
  parseCommercialProjectDetail,
  parseCommercialProjectList,
  parseCommercialProjectWorkflow,
  parseCommercialStepResponse,
  parseCommercialWorkflowLayoutRequest,
  parseCommercialWorkflowLayoutResponse,
  parseCommercialWriteError,
  type CommercialDefaultTemplate,
  type CommercialNodeWriteResponse,
  type CommercialOpenItemCreateRequest,
  type CommercialOpenItemUpdateRequest,
  type CommercialOpenItemWriteResponse,
  type CommercialProjectArchiveResponse,
  type CommercialProjectDetail,
  type CommercialProjectListResponse,
  type CommercialProjectWorkflow,
  type CommercialStepPublish,
  type CommercialStageStepToken,
  type CommercialWorkflowLayoutRequest,
  type CommercialWorkflowLayoutResponse,
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

export type LiveProjectListParams = {
  originKind?: 'real' | 'fixture' | 'manual' | 'unclassified' | '';
  /** When true, list includes soft-archived rows (`includeArchived=1`). */
  includeArchived?: boolean;
};

export function fetchLiveProjectList(
  params: LiveProjectListParams = {},
): Promise<CommercialProjectListResponse> {
  const search = new URLSearchParams();
  if (params.originKind) search.set('originKind', params.originKind);
  if (params.includeArchived) search.set('includeArchived', '1');
  const qs = search.toString();
  return getJson('/api/v1/commercial/projects' + (qs ? `?${qs}` : '')).then((body) =>
    parseRead(parseCommercialProjectList, body),
  );
}

async function postArchiveAction(
  projectId: string,
  action: 'archive' | 'unarchive',
): Promise<CommercialProjectArchiveResponse> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/commercial/projects/${encodeURIComponent(projectId)}/${action}`, {
      method: 'POST',
    });
  } catch (err) {
    throw new CommercialReadError(err instanceof Error ? err.message : '网络异常', 0, 'http');
  }
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `HTTP ${res.status}`;
    throw new CommercialReadError(message, res.status, 'http');
  }
  return parseRead(parseCommercialProjectArchiveResponse, payload);
}

export function archiveLiveProject(projectId: string): Promise<CommercialProjectArchiveResponse> {
  return postArchiveAction(projectId, 'archive');
}

export function unarchiveLiveProject(projectId: string): Promise<CommercialProjectArchiveResponse> {
  return postArchiveAction(projectId, 'unarchive');
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

export async function saveLiveWorkflowLayout(
  projectId: string,
  body: CommercialWorkflowLayoutRequest,
): Promise<CommercialWorkflowLayoutResponse> {
  const request = parseCommercialWorkflowLayoutRequest(body);
  const res = await fetch(
    `/api/v1/commercial/projects/${encodeURIComponent(projectId)}/workflow/layout`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
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
  return parseCommercialWorkflowLayoutResponse(payload);
}

async function writeOpenItem(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
): Promise<CommercialOpenItemWriteResponse> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new CommercialReadError(err instanceof Error ? err.message : '网络异常', 0, 'http');
  }
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `HTTP ${res.status}`;
    throw new CommercialReadError(message, res.status, 'http');
  }
  return parseRead(parseCommercialOpenItemWriteResponse, payload);
}

export function createLiveOpenItem(
  projectId: string,
  body: CommercialOpenItemCreateRequest,
): Promise<CommercialOpenItemWriteResponse> {
  const request = parseCommercialOpenItemCreateRequest(body);
  return writeOpenItem(
    `/api/v1/commercial/projects/${encodeURIComponent(projectId)}/open-items`,
    'POST',
    request,
  );
}

export function updateLiveOpenItem(
  projectId: string,
  itemId: string,
  body: CommercialOpenItemUpdateRequest,
): Promise<CommercialOpenItemWriteResponse> {
  const request = parseCommercialOpenItemUpdateRequest(body);
  return writeOpenItem(
    `/api/v1/commercial/projects/${encodeURIComponent(projectId)}/open-items/${encodeURIComponent(itemId)}`,
    'PATCH',
    request,
  );
}

export type LiveStepResult =
  { ok: true } | { ok: false; status: number; body: CommercialWriteErrorBody };

async function postStep(
  path: string,
  body: unknown,
  parseOk: (value: unknown) => unknown = parseCommercialStepResponse,
): Promise<LiveStepResult> {
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
  parseOk(payload);
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

export function postLiveNodeUnblock(
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
): Promise<LiveStepResult> {
  return postStep(
    `/api/v1/commercial/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/unblock`,
    { expectedUpdatedAt },
    parseCommercialNodeWriteResponse,
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
