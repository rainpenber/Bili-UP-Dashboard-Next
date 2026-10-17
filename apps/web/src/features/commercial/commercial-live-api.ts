import {
  parseCommercialDefaultTemplate,
  parseCommercialProjectDetail,
  parseCommercialProjectWorkflow,
  type CommercialDefaultTemplate,
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

export function fetchLiveDefaultTemplate(): Promise<CommercialDefaultTemplate> {
  return getJson('/api/v1/commercial/templates/default').then(parseCommercialDefaultTemplate);
}
