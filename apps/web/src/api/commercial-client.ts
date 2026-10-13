import {
  homeDashboardSchema,
  openItemSchema,
  paginatedSchema,
  projectSummarySchema,
  workflowGraphSchema,
  type HomeDashboard,
  type OpenItemDto,
  type ProjectSummary,
  type WorkflowGraph,
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

export async function fetchProjects(params: { page?: string; q?: string }) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', params.page);
  if (params.q) qs.set('q', params.q);
  return paginatedSchema(projectSummarySchema).parse(
    await requestJson(`/projects?${qs.toString()}`),
  );
}

export async function fetchProject(id: string): Promise<ProjectSummary> {
  return projectSummarySchema.parse(await requestJson(`/projects/${encodeURIComponent(id)}`));
}

export async function fetchWorkflow(id: string): Promise<WorkflowGraph> {
  return workflowGraphSchema.parse(
    await requestJson(`/projects/${encodeURIComponent(id)}/workflow`),
  );
}

export async function createProject(name: string): Promise<ProjectSummary> {
  return projectSummarySchema.parse(
    await requestJson('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  );
}

export async function advanceNode(projectId: string, nodeId: string): Promise<WorkflowGraph> {
  return workflowGraphSchema.parse(
    await requestJson(
      `/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/advance`,
      { method: 'POST' },
    ),
  );
}

export async function fetchOpenItems(projectId: string): Promise<{ items: OpenItemDto[] }> {
  const raw = (await requestJson(`/projects/${encodeURIComponent(projectId)}/open-items`)) as {
    items: unknown[];
  };
  return { items: raw.items.map((i) => openItemSchema.parse(i)) };
}
