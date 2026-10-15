import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { WorkflowGraph } from '../types';
import { useWorkflowEditor } from '../use-workflow-editor';
import { indexWorkflowNodes } from '../workflow-edit-logic';
import { listWorkflowConnections } from '../workflow-structure-logic';
import { workflowNodeStatusLabel } from '../workflow-node-visual';
import type { WorkflowNodeEditorActions } from '../workflow-graph-flow-layout';
import { WorkflowGraphCanvasProvider } from './workflow-graph-canvas';

const LEGEND = [
  { label: '已完成', className: 'border-emerald-600 bg-emerald-100' },
  { label: '进行中', className: 'border-amber-600 bg-amber-100' },
  { label: '被卡住', className: 'border-red-600 bg-red-100' },
  { label: '未到', className: 'border-zinc-400 bg-zinc-100' },
] as const;

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
  /** Hide status actions; used by default-flow template editing. */
  structureOnly?: boolean;
  mockNotice?: string;
}) {
  const {
    graph,
    selectedNodeId,
    setSelectedNodeId,
    startProgress,
    completeNode,
    rollback,
    block,
    clearBlock,
    addNode,
    requestDeleteNode,
    confirmDeleteNode,
    cancelDeletePrompt,
    deletePrompt,
    connectNodes,
    disconnectNodes,
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
  const [newNodeName, setNewNodeName] = useState('');
  const [connectFromId, setConnectFromId] = useState('');
  const [connectToId, setConnectToId] = useState('');

  const nodeOptions = useMemo(() => [...indexWorkflowNodes(graph).values()], [graph]);
  const connections = useMemo(() => listWorkflowConnections(graph), [graph]);

  // Keep a previously recorded reason visible when reopening that node's controls.
  useEffect(() => {
    if (!selectedNode) {
      setBlockReasonDraft('');
      return;
    }
    setBlockReasonDraft(selectedNode.blockingReason ?? '');
  }, [selectedNodeId, selectedNode?.blockingReason, selectedNode?.status]);

  const buildNodeEditor = useCallback(
    (nodeId: string): WorkflowNodeEditorActions | undefined => {
      if (structureOnly) return undefined;
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
    [
      structureOnly,
      selectedNodeId,
      startProgress,
      completeNode,
      rollback,
      block,
      clearBlock,
      blockReasonDraft,
    ],
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground" data-testid="workflow-mock-notice">
        {mockNotice ??
          '演示数据：节点状态与结构仅保存在本页内存中，刷新后会恢复为初始 Mock，不会写入服务器。'}
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

      <div
        className="space-y-3 rounded-lg border bg-card/40 p-3"
        data-testid="workflow-structure-panel"
      >
        <p className="text-sm font-medium text-foreground">结构编辑</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>新节点名称</span>
            <Input
              value={newNodeName}
              onChange={(e) => setNewNodeName(e.target.value)}
              placeholder="例如：样片预审"
              className="h-8 w-44 text-sm"
              data-testid="workflow-add-node-name"
            />
          </label>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (addNode(newNodeName)) setNewNodeName('');
            }}
            data-testid="workflow-add-node"
          >
            添加节点
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>从</span>
            <select
              className="flex h-8 w-40 rounded-md border border-input bg-background px-2 text-sm"
              value={connectFromId}
              onChange={(e) => setConnectFromId(e.target.value)}
              data-testid="workflow-connect-from"
            >
              <option value="">选择节点</option>
              {nodeOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>到</span>
            <select
              className="flex h-8 w-40 rounded-md border border-input bg-background px-2 text-sm"
              value={connectToId}
              onChange={(e) => setConnectToId(e.target.value)}
              data-testid="workflow-connect-to"
            >
              <option value="">选择节点</option>
              {nodeOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            disabled={!connectFromId || !connectToId}
            onClick={() => connectNodes(connectFromId, connectToId)}
            data-testid="workflow-connect"
          >
            连接
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!connectFromId || !connectToId}
            onClick={() => disconnectNodes(connectFromId, connectToId)}
            data-testid="workflow-disconnect"
          >
            断开连接
          </Button>
        </div>
        {selectedNode ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">已选节点：{selectedNode.name}</span>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => requestDeleteNode(selectedNode.id)}
              data-testid="workflow-delete-node"
            >
              删除节点
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">点击节点后可删除该节点。</p>
        )}
        <ul
          className="max-h-28 overflow-auto text-xs text-muted-foreground"
          data-testid="workflow-connection-list"
          aria-label="当前连接"
        >
          {connections.map((c) => {
            const fromName = nodeOptions.find((n) => n.id === c.from)?.name ?? c.from;
            const toName = nodeOptions.find((n) => n.id === c.to)?.name ?? c.to;
            return (
              <li key={`${c.from}->${c.to}`} data-connection={`${c.from}->${c.to}`}>
                {fromName} → {toName}
              </li>
            );
          })}
        </ul>
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
      {deletePrompt ? (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
          role="alertdialog"
          data-testid="workflow-delete-confirm"
        >
          <p>
            删除节点「{deletePrompt.nodeName}」将同时移除以下连接：
            {deletePrompt.connections.map((c) => `${c.fromName} → ${c.toName}`).join('；')}
            。确认继续？
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={confirmDeleteNode}
              data-testid="workflow-delete-confirm-yes"
            >
              确认删除
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={cancelDeletePrompt}
              data-testid="workflow-delete-confirm-cancel"
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
            <div className="space-y-2">
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
              </div>
              {!structureOnly && selectedNode.status === 'in_progress' ? (
                <div className="space-y-2 border-t border-border/60 pt-2">
                  <label className="block space-y-1 text-xs">
                    <span className="text-muted-foreground">阻塞原因（可选，可留空）</span>
                    <Input
                      value={blockReasonDraft}
                      onChange={(e) => setBlockReasonDraft(e.target.value)}
                      placeholder="阻塞原因（可选）"
                      className="h-8 text-sm"
                      data-testid="workflow-block-reason-input"
                      aria-label="阻塞原因（可选）"
                    />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-8 w-full text-xs"
                    onClick={() => block(selectedNode.id, blockReasonDraft)}
                    data-testid="workflow-block-submit"
                  >
                    标记阻塞
                  </Button>
                </div>
              ) : null}
              {!structureOnly &&
              selectedNode.status === 'blocked' &&
              selectedNode.blockingReason ? (
                <p
                  className="text-xs text-destructive"
                  data-testid="workflow-aside-blocking-reason"
                >
                  {selectedNode.blockingReason}
                </p>
              ) : null}
              <p className="text-xs">
                {structureOnly
                  ? '在左侧面板增删节点或调整连接；此处仅作上下文说明。'
                  : '在节点卡片或本侧栏可标记阻塞；左侧可改结构。'}
              </p>
            </div>
          ) : (
            <p>
              {structureOnly
                ? '点击节点以选中后删除，或在左侧添加/连接节点。'
                : '点击节点展开卡片，在卡片内切换进行中 / 完成或标记阻塞；左侧可改结构。'}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
