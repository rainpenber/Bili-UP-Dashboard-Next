import {
  parseCommercialDefaultTemplate,
  parseCommercialNodeWriteResponse,
  parseCommercialProjectDetail,
  parseCommercialProjectWorkflow,
  parseCommercialStepResponse,
  parseCommercialWriteError,
  type CommercialDefaultTemplate,
  type CommercialNodeWriteResponse,
  type CommercialProjectDetail,
  type CommercialProjectWorkflow,
  type CommercialStepPublish,
  type CommercialStageStepToken,
  type CommercialWriteErrorBody,
} from '@studio/contracts';

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function fetchLiveProjectDetail(projectId: string): Promise<CommercialProjectDetail> {
  return getJson(`/api/v1/commercial/projects/${encodeURIComponent(projectId)}`).then(
    parseCommercialProjectDetail,
  );
}

export function fetchLiveProjectWorkflow(projectId: string): Promise<CommercialProjectWorkflow> {
  return getJson(`/api/v1/commercial/projects/${encodeURIComponent(projectId)}/workflow`).then(
    parseCommercialProjectWorkflow,
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
  return getJson('/api/v1/commercial/templates/default').then(parseCommercialDefaultTemplate);
}
