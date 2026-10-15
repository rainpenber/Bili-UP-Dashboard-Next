import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkflowGraph } from '../types';
import { useWorkflowEditor } from '../use-workflow-editor';
import { indexWorkflowNodes } from '../workflow-edit-logic';
import { workflowNodeStatusLabel } from '../workflow-node-visual';
import type { WorkflowNodeEditorActions } from '../workflow-graph-flow-layout';
import { WorkflowGraphCanvasProvider } from './workflow-graph-canvas';

const LEGEND = [
  { label: '已完成', className: 'border-success bg-success/30' },
  { label: '进行中', className: 'border-warning bg-warning/35' },
  { label: '被卡住', className: 'border-destructive bg-destructive/25' },
  { label: '未到', className: 'border-border bg-muted' },
] as const;

export type WorkflowGraphEditorHandle = ReturnType<typeof useWorkflowEditor>;

export function useProjectWorkflowEditor(initialGraph: WorkflowGraph) {
  return useWorkflowEditor(initialGraph);
}

export function WorkflowGraphEditor({ editor }: { editor: WorkflowGraphEditorHandle }) {
  const {
    graph,
    selectedNodeId,
    setSelectedNodeId,
    startProgress,
    completeNode,
    rollback,
    block,
    clearBlock,
    undo,
    redo,
    canUndo,
    canRedo,
    actionError,
    clearActionError,
    predecessorPrompt,
    confirmPredecessorsAndContinue,
    cancelPredecessorPrompt,
  } = editor;

  const selectedNode = selectedNodeId ? indexWorkflowNodes(graph).get(selectedNodeId) : undefined;
  const [blockReasonDraft, setBlockReasonDraft] = useState('');

  const buildNodeEditor = useCallback(
    (nodeId: string): WorkflowNodeEditorActions | undefined => {
      if (nodeId !== selectedNodeId) return undefined;
      return {
        onStart: () => startProgress(nodeId),
        onComplete: () => completeNode(nodeId),
        onRollback: () => rollback(nodeId),
        onBlock: (reason) => block(nodeId, reason),
        onClearBlock: () => clearBlock(nodeId),
        blockReasonDraft,
        setBlockReasonDraft,
      };
    },
    [selectedNodeId, startProgress, completeNode, rollback, block, clearBlock, blockReasonDraft],
  );

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
      {predecessorPrompt ? (
        <div
          className="rounded-md border border-warning/50 bg-warning/15 p-3 text-sm"
          role="alertdialog"
          data-testid="workflow-predecessor-confirm"
        >
          <p>
            须先完成前置节点：
            {predecessorPrompt.blockers.map((b) => b.name).join('、')}。是否一并标记完成并继续？
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={confirmPredecessorsAndContinue}
              data-testid="workflow-predecessor-confirm-yes"
            >
              一并完成前置并继续
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={cancelPredecessorPrompt}
              data-testid="workflow-predecessor-confirm-cancel"
            >
              取消
            </Button>
          </div>
        </div>
      ) : null}
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
      <div className="grid gap-4 lg:grid-cols-[1fr_min(14rem,100%)]">
        <WorkflowGraphCanvasProvider
          graph={graph}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          buildNodeEditor={buildNodeEditor}
        />
        <aside
          className="rounded-lg border bg-card p-4 text-sm text-muted-foreground"
          data-testid="workflow-node-detail"
          aria-live="polite"
        >
          {selectedNode ? (
            <div className="space-y-1">
              <p
                className="text-base font-medium text-foreground"
                data-testid="workflow-detail-name"
              >
                {selectedNode.name}
              </p>
              <p data-testid="workflow-detail-status">
                {workflowNodeStatusLabel(selectedNode.status)}
              </p>
              <p className="text-xs">在节点卡片内操作状态；此处仅作上下文说明。</p>
            </div>
          ) : (
            <p>点击节点展开卡片，在卡片内切换进行中 / 完成或标记阻塞。</p>
          )}
        </aside>
      </div>
    </div>
  );
}
