import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { WorkflowGraph } from '../types';
import { useWorkflowEditor } from '../use-workflow-editor';
import { deriveWorkflowSummary, indexWorkflowNodes } from '../workflow-edit-logic';
import { workflowNodeStatusLabel } from '../workflow-node-visual';
import { WorkflowGraphCanvasProvider } from './workflow-graph-canvas';

const LEGEND = [
  { label: '已完成', className: 'border-success/50 bg-success/15' },
  { label: '进行中', className: 'border-warning/50 bg-warning/15' },
  { label: '被卡住', className: 'border-destructive/50 bg-destructive/15' },
  { label: '未到', className: 'border-border bg-muted/40' },
] as const;

export type WorkflowGraphEditorHandle = ReturnType<typeof useWorkflowEditor>;

export function useProjectWorkflowEditor(initialGraph: WorkflowGraph) {
  return useWorkflowEditor(initialGraph);
}

export function ProjectWorkflowSummaryFromGraph({ graph }: { graph: WorkflowGraph }) {
  const summary = deriveWorkflowSummary(graph);
  return (
    <div data-testid="workflow-derived-summary" className="hidden" aria-hidden>
      {summary.statusHeadline}|{summary.inProgressNodeNames.join(',')}|
      {summary.blockingReason ?? ''}
    </div>
  );
}

export function WorkflowGraphEditor({ editor }: { editor: WorkflowGraphEditorHandle }) {
  const {
    graph,
    selectedNodeId,
    setSelectedNodeId,
    advance,
    rollback,
    block,
    clearBlock,
    undo,
    redo,
    canUndo,
    canRedo,
    actionError,
    clearActionError,
  } = editor;

  const selectedNode = selectedNodeId ? indexWorkflowNodes(graph).get(selectedNodeId) : undefined;
  const [blockReasonDraft, setBlockReasonDraft] = useState('');

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground" data-testid="workflow-mock-notice">
        演示数据：节点状态仅保存在本页内存中，刷新后会恢复为初始 Mock，不会写入服务器。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canUndo}
          onClick={undo}
          data-testid="workflow-undo"
        >
          撤销
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canRedo}
          onClick={redo}
          data-testid="workflow-redo"
        >
          重做
        </Button>
        <span className="text-xs text-muted-foreground">
          快捷键：Ctrl/⌘+Z 撤销，Ctrl/⌘+Shift+Z 重做
        </span>
      </div>
      <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="流程图图例">
        {LEGEND.map((item) => (
          <li key={item.label} className="flex items-center gap-1.5">
            <span className={cn('size-3 rounded-sm border', item.className)} aria-hidden />
            {item.label}
          </li>
        ))}
      </ul>
      {actionError ? (
        <p
          className="text-sm text-destructive"
          role="alert"
          data-testid="workflow-action-error"
          onClick={clearActionError}
        >
          {actionError}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_min(18rem,100%)]">
        <WorkflowGraphCanvasProvider
          graph={graph}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
        />
        <aside
          className="rounded-lg border bg-card p-4 text-sm"
          data-testid="workflow-node-detail"
          aria-live="polite"
        >
          {selectedNode ? (
            <div className="space-y-4">
              <div>
                <p className="text-base font-medium" data-testid="workflow-detail-name">
                  {selectedNode.name}
                </p>
                <p className="text-muted-foreground" data-testid="workflow-detail-status">
                  {workflowNodeStatusLabel(selectedNode.status)}
                </p>
                {selectedNode.blockingReason ? (
                  <p
                    className="mt-2 text-destructive"
                    data-testid="workflow-detail-blocking-reason"
                  >
                    {selectedNode.blockingReason}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => selectedNodeId && advance(selectedNodeId)}
                  data-testid="workflow-advance"
                >
                  推进
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => selectedNodeId && rollback(selectedNodeId)}
                  data-testid="workflow-rollback"
                >
                  回退
                </Button>
              </div>
              {selectedNode.status === 'in_progress' ? (
                <div className="space-y-2">
                  <Label htmlFor="workflow-block-reason">标记阻塞</Label>
                  <Input
                    id="workflow-block-reason"
                    value={blockReasonDraft}
                    onChange={(e) => setBlockReasonDraft(e.target.value)}
                    placeholder="必填：阻塞原因"
                    data-testid="workflow-block-reason-input"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (selectedNodeId) block(selectedNodeId, blockReasonDraft);
                    }}
                    data-testid="workflow-block-submit"
                  >
                    确认阻塞
                  </Button>
                </div>
              ) : null}
              {selectedNode.status === 'blocked' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => selectedNodeId && clearBlock(selectedNodeId)}
                  data-testid="workflow-clear-block"
                >
                  解除阻塞
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground">点击流程图中的节点，在此推进、回退或标记阻塞。</p>
          )}
        </aside>
      </div>
    </div>
  );
}
