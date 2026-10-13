import type {
  DashboardTodayResponse,
  OpenItemDto,
  Paginated,
  ProjectSummary,
  ProjectWorkflowResponse,
  TeamMember,
} from '@studio/contracts';

const API_BASE = '/api/v1';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchDashboardToday(referenceNow?: string): Promise<DashboardTodayResponse> {
  const qs = referenceNow ? `?referenceNow=${encodeURIComponent(referenceNow)}` : '';
  return requestJson(`/dashboard/today${qs}`);
}

export function fetchProjects(
  params: Record<string, string | undefined>,
): Promise<Paginated<ProjectSummary>> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  return requestJson(`/projects?${qs.toString()}`);
}

export function fetchProject(id: string): Promise<ProjectSummary> {
  return requestJson(`/projects/${encodeURIComponent(id)}`);
}

export function fetchTeamMembers(): Promise<{ items: TeamMember[] }> {
  return requestJson('/projects/team-members');
}

export function createProject(body: Record<string, unknown>): Promise<ProjectSummary> {
  return requestJson('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function patchProject(id: string, body: Record<string, unknown>): Promise<ProjectSummary> {
  return requestJson(`/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function archiveProject(id: string): Promise<ProjectSummary> {
  return requestJson(`/projects/${encodeURIComponent(id)}/archive`, { method: 'POST' });
}

export function restoreProject(id: string): Promise<ProjectSummary> {
  return requestJson(`/projects/${encodeURIComponent(id)}/restore`, { method: 'POST' });
}

export function fetchProjectWorkflow(id: string): Promise<ProjectWorkflowResponse> {
  return requestJson(`/projects/${encodeURIComponent(id)}/workflow`);
}

export function patchWorkflowNode(
  projectId: string,
  nodeId: string,
  body: Record<string, unknown>,
): Promise<ProjectWorkflowResponse> {
  return requestJson(
    `/projects/${encodeURIComponent(projectId)}/workflow/nodes/${encodeURIComponent(nodeId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export function fetchOpenItems(projectId: string): Promise<{ items: OpenItemDto[] }> {
  return requestJson(`/projects/${encodeURIComponent(projectId)}/open-items`);
}

export function createOpenItem(
  projectId: string,
  body: Record<string, unknown>,
): Promise<OpenItemDto> {
  return requestJson(`/projects/${encodeURIComponent(projectId)}/open-items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function patchOpenItem(
  projectId: string,
  itemId: string,
  body: Record<string, unknown>,
): Promise<OpenItemDto> {
  return requestJson(
    `/projects/${encodeURIComponent(projectId)}/open-items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}
