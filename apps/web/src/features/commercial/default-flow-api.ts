import {
  parseCommercialProjectDetail,
  parseCommercialProjectWorkflow,
  parseCreatedCommercialProject,
  parseDefaultTemplateWorkspace,
  type AddTemplateNodeRequest,
  type CommercialProjectDetail,
  type CommercialProjectWorkflow,
  type CreatedCommercialProject,
  type DefaultTemplateWorkspace,
} from '@studio/contracts';

const API_BASE = '/api/v1/commercial';

export type DefaultFlowClient = {
  loadWorkspace(): Promise<DefaultTemplateWorkspace>;
  startDraft(): Promise<DefaultTemplateWorkspace>;
  discardDraft(): Promise<DefaultTemplateWorkspace>;
  publishDraft(): Promise<DefaultTemplateWorkspace>;
  addNode(versionId: string, body: AddTemplateNodeRequest): Promise<DefaultTemplateWorkspace>;
  renameNode(versionId: string, nodeId: string, name: string): Promise<DefaultTemplateWorkspace>;
  deleteNode(versionId: string, nodeId: string): Promise<DefaultTemplateWorkspace>;
  addEdge(
    versionId: string,
    fromNodeId: string,
    toNodeId: string,
  ): Promise<DefaultTemplateWorkspace>;
  disconnectEdge(
    versionId: string,
    fromNodeId: string,
    toNodeId: string,
  ): Promise<DefaultTemplateWorkspace>;
  createProject(name: string, templateVersionId: string): Promise<CreatedCommercialProject>;
};

async function request<T>(
  path: string,
  parse: (value: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string' &&
      body.error.length > 0
        ? body.error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return parse(body);
}

function sendJson(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const defaultFlowClient: DefaultFlowClient = {
  loadWorkspace: () => request('/templates/default/workspace', parseDefaultTemplateWorkspace),
  startDraft: () =>
    request('/templates/default/draft', parseDefaultTemplateWorkspace, { method: 'POST' }),
  discardDraft: () =>
    request('/templates/default/draft', parseDefaultTemplateWorkspace, { method: 'DELETE' }),
  publishDraft: () =>
    request('/templates/default/draft/publish', parseDefaultTemplateWorkspace, { method: 'POST' }),
  addNode: (versionId, body) =>
    request(
      `/templates/default/versions/${versionId}/nodes`,
      parseDefaultTemplateWorkspace,
      sendJson('POST', body),
    ),
  renameNode: (versionId, nodeId, name) =>
    request(
      `/templates/default/versions/${versionId}/nodes/${nodeId}`,
      parseDefaultTemplateWorkspace,
      sendJson('PATCH', { name }),
    ),
  deleteNode: (versionId, nodeId) =>
    request(
      `/templates/default/versions/${versionId}/nodes/${nodeId}`,
      parseDefaultTemplateWorkspace,
      {
        method: 'DELETE',
      },
    ),
  addEdge: (versionId, fromNodeId, toNodeId) =>
    request(
      `/templates/default/versions/${versionId}/edges`,
      parseDefaultTemplateWorkspace,
      sendJson('POST', { fromNodeId, toNodeId }),
    ),
  disconnectEdge: (versionId, fromNodeId, toNodeId) =>
    request(
      `/templates/default/versions/${versionId}/edges/disconnect`,
      parseDefaultTemplateWorkspace,
      sendJson('POST', { fromNodeId, toNodeId }),
    ),
  createProject: (name, templateVersionId) =>
    request(
      '/projects',
      parseCreatedCommercialProject,
      sendJson('POST', { name, templateVersionId }),
    ),
};

export function fetchProjectDetail(projectId: string): Promise<CommercialProjectDetail> {
  return request(`/projects/${projectId}`, parseCommercialProjectDetail);
}

export function fetchProjectWorkflow(projectId: string): Promise<CommercialProjectWorkflow> {
  return request(`/projects/${projectId}/workflow`, parseCommercialProjectWorkflow);
}
