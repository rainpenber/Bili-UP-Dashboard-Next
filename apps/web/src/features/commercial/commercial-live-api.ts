import {
  parseCommercialDefaultTemplate,
  parseCommercialNodeWriteResponse,
  parseCommercialProjectDetail,
  parseCommercialProjectWorkflow,
  type CommercialDefaultTemplate,
  type CommercialNodeWriteResponse,
  type CommercialProjectDetail,
  type CommercialProjectWorkflow,
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

export function fetchLiveDefaultTemplate(): Promise<CommercialDefaultTemplate> {
  return getJson('/api/v1/commercial/templates/default').then(parseCommercialDefaultTemplate);
}
