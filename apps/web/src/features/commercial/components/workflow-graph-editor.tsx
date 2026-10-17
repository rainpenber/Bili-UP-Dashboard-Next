import { useMemo } from 'react';
import type { WorkflowGraph } from '../types';
import { useWorkflowEditor } from '../use-workflow-editor';
import { workflowGraphToLive } from '../workflow-live-graph';
import { WorkflowLiveCanvas } from './workflow-live-canvas';

export type WorkflowGraphEditorHandle = ReturnType<typeof useWorkflowEditor>;

export function useProjectWorkflowEditor(initialGraph: WorkflowGraph) {
  return useWorkflowEditor(initialGraph);
}

export function WorkflowGraphEditor({
  editor,
  structureOnly = false,
  mockNotice,
}: {
  editor: WorkflowGraphEditorHandle;
  /** Template drafts still rename in place. Structural writes stay on the hook for I-2. */
  structureOnly?: boolean;
  mockNotice?: string;
}) {
  const live = useMemo(() => workflowGraphToLive(editor.graph), [editor.graph]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground" data-testid="workflow-mock-notice">
        {mockNotice ??
          (structureOnly
            ? '草稿只保存在本页。改名可撤销；增删节点和连线留到后续。'
            : '状态来自当前流程，四格只展示。改名可撤销；增删节点、连线和状态推进留到后续。')}
      </p>
      {editor.actionError ? (
        <p
          className="text-sm text-destructive"
          role="alert"
          data-testid="workflow-action-error"
          onClick={editor.clearActionError}
        >
          {editor.actionError}
        </p>
      ) : null}
      <WorkflowLiveCanvas
        nodes={live.nodes}
        edges={live.edges}
        label={structureOnly ? '默认流程' : '流程'}
        onRename={editor.renameNode}
      />
    </div>
  );
}
