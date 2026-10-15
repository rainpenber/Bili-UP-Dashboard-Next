import { defaultWorkflowTemplate } from './mock-data';
import type { DefaultFlowPublishedVersion, DefaultFlowWorkspace, WorkflowGraph } from './types';
import { cloneWorkflowGraph } from './workflow-edit-logic';

function nowLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function createInitialWorkspace(): DefaultFlowWorkspace {
  const graph = cloneWorkflowGraph(defaultWorkflowTemplate.graph);
  return {
    title: defaultWorkflowTemplate.title,
    description: defaultWorkflowTemplate.description,
    draft: graph,
    savedDraft: cloneWorkflowGraph(graph),
    publishedVersions: [
      {
        id: 'default-v1',
        version: 1,
        publishedAtLabel: '初始模板',
        graph: cloneWorkflowGraph(graph),
      },
    ],
    viewingVersionId: null,
  };
}

let workspace: DefaultFlowWorkspace = createInitialWorkspace();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getDefaultFlowWorkspace(): DefaultFlowWorkspace {
  return workspace;
}

export function subscribeDefaultFlowWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetDefaultFlowWorkspaceForTests(): void {
  workspace = createInitialWorkspace();
  emit();
}

export function setDefaultFlowDraft(graph: WorkflowGraph): void {
  workspace = {
    ...workspace,
    draft: cloneWorkflowGraph(graph),
    viewingVersionId: null,
  };
  emit();
}

export function saveDefaultFlowDraft(): void {
  workspace = {
    ...workspace,
    savedDraft: cloneWorkflowGraph(workspace.draft),
    viewingVersionId: null,
  };
  emit();
}

export function publishDefaultFlowVersion(): DefaultFlowPublishedVersion {
  const nextVersion =
    workspace.publishedVersions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
  const published: DefaultFlowPublishedVersion = {
    id: `default-v${nextVersion}`,
    version: nextVersion,
    publishedAtLabel: nowLabel(),
    graph: cloneWorkflowGraph(workspace.draft),
  };
  workspace = {
    ...workspace,
    savedDraft: cloneWorkflowGraph(workspace.draft),
    publishedVersions: [published, ...workspace.publishedVersions],
    viewingVersionId: null,
  };
  emit();
  return published;
}

export function viewDefaultFlowVersion(versionId: string | null): void {
  workspace = {
    ...workspace,
    viewingVersionId: versionId,
  };
  emit();
}

export function getViewedDefaultFlowGraph(): WorkflowGraph {
  if (workspace.viewingVersionId) {
    const found = workspace.publishedVersions.find((v) => v.id === workspace.viewingVersionId);
    if (found) return found.graph;
  }
  return workspace.draft;
}
