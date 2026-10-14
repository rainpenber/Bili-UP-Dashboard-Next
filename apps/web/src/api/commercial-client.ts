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

export async function applyBatchGraphLayout(
  projectId: string,
  nodes: Array<{ nodeId: string; posX: number; posY: number }>,
) {
  return workflowGraphSchema.parse(
    await requestJson(`/projects/${encodeURIComponent(projectId)}/workflow/layout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodes }),
    }),
  );
}

export async function patchGraphNode(
  projectId: string,
  nodeId: string,
  body: {
    name?: string;
    posX?: number;
    posY?: number;
    plannedAt?: string | null;
    phase?: string;
    isOptional?: boolean;
    packageId?: string | null;
  },
) {
  return workflowGraphSchema.parse(
    await requestJson(
      `/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
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

export async function deleteGraphEdge(projectId: string, edgeId: string) {
  return workflowGraphSchema.parse(
    await requestJson(
      `/projects/${encodeURIComponent(projectId)}/edges/${encodeURIComponent(edgeId)}`,
      { method: 'DELETE' },
    ),
  );
}

export async function deleteGraphNode(projectId: string, nodeId: string) {
  return workflowGraphSchema.parse(
    await requestJson(
      `/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`,
      { method: 'DELETE' },
    ),
  );
}

export async function createGraphNode(
  projectId: string,
  body: {
    name: string;
    posX: number;
    posY: number;
    phase?: string;
    isOptional?: boolean;
    packageId?: string | null;
    anchorNodeId?: string;
    connectMode?: 'serial' | 'parallel';
  },
) {
  return workflowGraphSchema.parse(
    await requestJson(`/projects/${encodeURIComponent(projectId)}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export async function updateGraphNode(
  projectId: string,
  nodeId: string,
  body: { name?: string; plannedAt?: string | null; posX?: number; posY?: number },
) {
  return workflowGraphSchema.parse(
    await requestJson(
      `/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
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

export async function closeOpenItem(projectId: string, itemId: string, conclusion: string) {
  return openItemSchema.parse(
    await requestJson(
      `/projects/${encodeURIComponent(projectId)}/open-items/${encodeURIComponent(itemId)}/close`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conclusion }),
      },
    ),
  );
}

export async function fetchOpenItemHistory(projectId: string, itemId: string) {
  const raw = (await requestJson(
    `/projects/${encodeURIComponent(projectId)}/open-items/${encodeURIComponent(itemId)}/history`,
  )) as {
    items: Array<{
      action: string;
      detail: Record<string, unknown> | null;
      source: string;
      createdAt: string;
    }>;
  };
  return raw.items;
}

export async function splitOpenItem(projectId: string, itemId: string, newTitles: string[]) {
  const raw = (await requestJson(
    `/projects/${encodeURIComponent(projectId)}/open-items/${encodeURIComponent(itemId)}/split`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newTitles }),
    },
  )) as { items: unknown[] };
  return raw.items.map((i) => openItemSchema.parse(i));
}

export async function mergeOpenItems(projectId: string, itemIds: string[], mergedTitle: string) {
  const raw = (await requestJson(`/projects/${encodeURIComponent(projectId)}/open-items/merge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemIds, mergedTitle }),
  })) as { items: unknown[] };
  return raw.items.map((i) => openItemSchema.parse(i));
}

export async function promoteOpenItemToNode(
  projectId: string,
  itemId: string,
  body: { nodeName: string; posX?: number; posY?: number },
) {
  return requestJson(
    `/projects/${encodeURIComponent(projectId)}/open-items/${encodeURIComponent(itemId)}/promote-to-node`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  ) as Promise<{ nodeId: string; workflow: WorkflowGraph }>;
}

export async function pinPrimaryBlock(projectId: string, itemId: string) {
  return requestJson(
    `/projects/${encodeURIComponent(projectId)}/open-items/${encodeURIComponent(itemId)}/pin-primary-block`,
    { method: 'POST' },
  );
}

export async function createTemplatePackage(versionId: string, name: string) {
  await requestJson(`/templates/versions/${encodeURIComponent(versionId)}/packages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return fetchTemplateGraph(versionId);
}

export async function cancelOpenItem(projectId: string, itemId: string, reason: string) {
  return openItemSchema.parse(
    await requestJson(
      `/projects/${encodeURIComponent(projectId)}/open-items/${encodeURIComponent(itemId)}/cancel`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      },
    ),
  );
}

export async function undoWorkflow(projectId: string): Promise<WorkflowGraph> {
  return workflowGraphSchema.parse(
    await requestJson(`/projects/${encodeURIComponent(projectId)}/workflow/undo`, {
      method: 'POST',
    }),
  );
}

export async function redoWorkflow(projectId: string): Promise<WorkflowGraph> {
  return workflowGraphSchema.parse(
    await requestJson(`/projects/${encodeURIComponent(projectId)}/workflow/redo`, {
      method: 'POST',
    }),
  );
}

export async function fetchTemplateVersions() {
  const raw = (await requestJson('/templates/versions')) as { items: unknown[] };
  return raw.items as Array<{
    id: string;
    slug: string;
    name: string;
    version: number;
    isDefault: boolean;
    isDraft: boolean;
    publishedAt: string;
  }>;
}

export async function createTemplateDraftFromDefault() {
  return requestJson('/templates/draft-from-default', { method: 'POST' }) as Promise<{
    draftId: string;
    nextVersion: number;
  }>;
}

export async function publishTemplateDraft(versionId: string) {
  return requestJson(`/templates/versions/${encodeURIComponent(versionId)}/publish`, {
    method: 'POST',
  }) as Promise<{ publishedVersionId: string }>;
}

export async function fetchTemplateGraph(versionId: string) {
  return requestJson(`/templates/versions/${encodeURIComponent(versionId)}/graph`) as Promise<{
    versionId: string;
    nodes: Array<{
      id: string;
      name: string;
      slug: string;
      phase: string;
      is_optional: boolean;
      pos_x: number;
      pos_y: number;
      package_id: string | null;
    }>;
    edges: Array<{ id: string; fromNodeId: string; toNodeId: string }>;
    packages?: Array<{ id: string; name: string; sortOrder: number }>;
  }>;
}

export async function saveTemplateNode(
  versionId: string,
  body: {
    id?: string;
    name: string;
    slug: string;
    phase: string;
    posX: number;
    posY: number;
    isOptional?: boolean;
    packageId?: string | null;
  },
  opts?: { recordUndo?: boolean },
) {
  const qs = opts?.recordUndo === false ? '?recordUndo=false' : '';
  await requestJson(`/templates/versions/${encodeURIComponent(versionId)}/nodes${qs}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return fetchTemplateGraph(versionId);
}

export async function applyTemplateBatchLayout(
  versionId: string,
  nodes: Array<{ nodeId: string; posX: number; posY: number }>,
) {
  return requestJson(`/templates/versions/${encodeURIComponent(versionId)}/workflow/layout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodes }),
  }) as ReturnType<typeof fetchTemplateGraph>;
}

export async function undoTemplateWorkflow(versionId: string) {
  return requestJson(`/templates/versions/${encodeURIComponent(versionId)}/workflow/undo`, {
    method: 'POST',
  }) as ReturnType<typeof fetchTemplateGraph>;
}

export async function redoTemplateWorkflow(versionId: string) {
  return requestJson(`/templates/versions/${encodeURIComponent(versionId)}/workflow/redo`, {
    method: 'POST',
  }) as ReturnType<typeof fetchTemplateGraph>;
}

export async function connectTemplateNodes(
  versionId: string,
  fromNodeId: string,
  toNodeId: string,
) {
  return requestJson(`/templates/versions/${encodeURIComponent(versionId)}/edges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fromNodeId, toNodeId }),
  }) as ReturnType<typeof fetchTemplateGraph>;
}

export async function deleteTemplateEdge(versionId: string, edgeId: string) {
  return requestJson(
    `/templates/versions/${encodeURIComponent(versionId)}/edges/${encodeURIComponent(edgeId)}`,
    { method: 'DELETE' },
  ) as ReturnType<typeof fetchTemplateGraph>;
}

export async function deleteTemplateNode(versionId: string, nodeId: string) {
  return requestJson(
    `/templates/versions/${encodeURIComponent(versionId)}/nodes/${encodeURIComponent(nodeId)}`,
    { method: 'DELETE' },
  ) as ReturnType<typeof fetchTemplateGraph>;
}

export async function validateTemplateDraft(versionId: string) {
  return requestJson(`/templates/versions/${encodeURIComponent(versionId)}/validate`, {
    method: 'POST',
  }) as Promise<{ ok: boolean }>;
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
