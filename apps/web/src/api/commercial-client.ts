import {
  createOpenItemBodySchema,
  homeDashboardSchema,
  openItemSchema,
  patchOpenItemBodySchema,
  projectDetailSchema,
  projectListGroupedSchema,
  publishProjectBodySchema,
  publishResultSchema,
  type HomeDashboard,
  type OpenItemDto,
  type ProjectDetailDto,
  type WorkflowGraph,
  workflowGraphSchema,
} from '@studio/contracts';

const API = '/api/v1/commercial';

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchHome(): Promise<HomeDashboard> {
  return homeDashboardSchema.parse(await requestJson('/home'));
}

export async function fetchProjectsGrouped(params: {
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  return projectListGroupedSchema.parse(await requestJson(`/projects/grouped?${qs.toString()}`));
}

export async function fetchProject(id: string): Promise<ProjectDetailDto> {
  return projectDetailSchema.parse(await requestJson(`/projects/${encodeURIComponent(id)}`));
}

export async function fetchWorkflow(id: string): Promise<WorkflowGraph> {
  return workflowGraphSchema.parse(
    await requestJson(`/projects/${encodeURIComponent(id)}/workflow`),
  );
}

export async function createProject(name: string): Promise<ProjectDetailDto> {
  return projectDetailSchema.parse(
    await requestJson('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  );
}

export async function advanceToNode(projectId: string, nodeId: string): Promise<WorkflowGraph> {
  return workflowGraphSchema.parse(
    await requestJson(
      `/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/advance-to`,
      { method: 'POST' },
    ),
  );
}

export async function completeNode(projectId: string, nodeId: string): Promise<WorkflowGraph> {
  return workflowGraphSchema.parse(
    await requestJson(
      `/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/complete`,
      { method: 'POST' },
    ),
  );
}

export async function rollbackNode(projectId: string, nodeId: string): Promise<WorkflowGraph> {
  return workflowGraphSchema.parse(
    await requestJson(
      `/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/rollback`,
      { method: 'POST' },
    ),
  );
}

export async function updateNodeLayout(
  projectId: string,
  nodeId: string,
  posX: number,
  posY: number,
) {
  return workflowGraphSchema.parse(
    await requestJson(
      `/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ posX, posY }),
      },
    ),
  );
}

export async function connectNodes(projectId: string, fromNodeId: string, toNodeId: string) {
  return workflowGraphSchema.parse(
    await requestJson(`/projects/${encodeURIComponent(projectId)}/edges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromNodeId, toNodeId }),
    }),
  );
}

export async function fetchOpenItems(projectId: string): Promise<{ items: OpenItemDto[] }> {
  const raw = (await requestJson(`/projects/${encodeURIComponent(projectId)}/open-items`)) as {
    items: unknown[];
  };
  return { items: raw.items.map((i) => openItemSchema.parse(i)) };
}

export async function createOpenItem(projectId: string, body: unknown) {
  const parsed = createOpenItemBodySchema.parse(body);
  return openItemSchema.parse(
    await requestJson(`/projects/${encodeURIComponent(projectId)}/open-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed),
    }),
  );
}

export async function patchOpenItem(projectId: string, itemId: string, body: unknown) {
  const parsed = patchOpenItemBodySchema.parse(body);
  return openItemSchema.parse(
    await requestJson(
      `/projects/${encodeURIComponent(projectId)}/open-items/${encodeURIComponent(itemId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      },
    ),
  );
}

export async function publishProject(projectId: string, body: unknown) {
  const parsed = publishProjectBodySchema.parse(body);
  return publishResultSchema.parse(
    await requestJson(`/projects/${encodeURIComponent(projectId)}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed),
    }),
  );
}
