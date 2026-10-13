import {
  dashboardTodayResponseSchema,
  openItemSchema,
  openItemsListResponseSchema,
  parseHermesChangeProposal,
  parseProjectPaginated,
  projectSummarySchema,
  projectWorkflowResponseSchema,
  teamMembersResponseSchema,
  type DashboardTodayResponse,
  type HermesChangeProposal,
  type OpenItemDto,
  type ProjectSummary,
  type ProjectWorkflowResponse,
  type TeamMember,
} from '@studio/contracts';

const API_BASE = '/api/v1';

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function parseJson<T>(
  path: string,
  init: RequestInit | undefined,
  schema: { parse: (v: unknown) => T },
): Promise<T> {
  return schema.parse(await requestJson(path, init));
}

export function fetchDashboardToday(referenceNow?: string): Promise<DashboardTodayResponse> {
  const qs = referenceNow ? `?referenceNow=${encodeURIComponent(referenceNow)}` : '';
  return parseJson(`/dashboard/today${qs}`, undefined, dashboardTodayResponseSchema);
}

export async function fetchProjects(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  return parseProjectPaginated(await requestJson(`/projects?${qs.toString()}`));
}

export function fetchProject(id: string): Promise<ProjectSummary> {
  return parseJson(`/projects/${encodeURIComponent(id)}`, undefined, projectSummarySchema);
}

export function fetchTeamMembers(): Promise<{ items: TeamMember[] }> {
  return parseJson('/projects/team-members', undefined, teamMembersResponseSchema);
}

export function createProject(body: Record<string, unknown>): Promise<ProjectSummary> {
  return parseJson(
    '/projects',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    projectSummarySchema,
  );
}

export function patchProject(id: string, body: Record<string, unknown>): Promise<ProjectSummary> {
  return parseJson(
    `/projects/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    projectSummarySchema,
  );
}

export function archiveProject(id: string): Promise<ProjectSummary> {
  return parseJson(
    `/projects/${encodeURIComponent(id)}/archive`,
    { method: 'POST' },
    projectSummarySchema,
  );
}

export function restoreProject(id: string): Promise<ProjectSummary> {
  return parseJson(
    `/projects/${encodeURIComponent(id)}/restore`,
    { method: 'POST' },
    projectSummarySchema,
  );
}

export function fetchProjectWorkflow(id: string): Promise<ProjectWorkflowResponse> {
  return parseJson(
    `/projects/${encodeURIComponent(id)}/workflow`,
    undefined,
    projectWorkflowResponseSchema,
  );
}

export function patchWorkflowNode(
  projectId: string,
  nodeId: string,
  body: Record<string, unknown>,
): Promise<ProjectWorkflowResponse> {
  return parseJson(
    `/projects/${encodeURIComponent(projectId)}/workflow/nodes/${encodeURIComponent(nodeId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    projectWorkflowResponseSchema,
  );
}

export function fetchOpenItems(projectId: string): Promise<{ items: OpenItemDto[] }> {
  return parseJson(
    `/projects/${encodeURIComponent(projectId)}/open-items`,
    undefined,
    openItemsListResponseSchema,
  );
}

export function createOpenItem(
  projectId: string,
  body: Record<string, unknown>,
): Promise<OpenItemDto> {
  return parseJson(
    `/projects/${encodeURIComponent(projectId)}/open-items`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    openItemSchema,
  );
}

export function patchOpenItem(
  projectId: string,
  itemId: string,
  body: Record<string, unknown>,
): Promise<OpenItemDto> {
  return parseJson(
    `/projects/${encodeURIComponent(projectId)}/open-items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    openItemSchema,
  );
}

export async function acceptHermesProposal(proposalId: string): Promise<HermesChangeProposal> {
  const raw = await requestJson(
    `/hermes/change-proposals/${encodeURIComponent(proposalId)}/accept`,
    { method: 'POST' },
  );
  return parseHermesChangeProposal(raw);
}
