import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { WriteFeedback } from '../commercial-api';
import type { NodeCommand } from '../node-actions';
import type { WorkflowGraph } from '../types';
import { workflowNodeStatusLabel } from '../workflow-node-visual';
import { indexWorkflowNodes } from '../workflow-edit-logic';
import { NodeActionPanel, type PublishDraft } from './node-action-panel';
import { WorkflowGraphCanvasProvider } from './workflow-graph-canvas';
import { WriteFeedbackBanner } from './write-feedback-banner';

const LEGEND = [
  { label: '已完成', className: 'border-emerald-600 bg-emerald-100' },
  { label: '进行中', className: 'border-amber-600 bg-amber-100' },
  { label: '被卡住', className: 'border-red-600 bg-red-100' },
  { label: '未到', className: 'border-zinc-400 bg-zinc-100' },
  { label: '不适用', className: 'border-zinc-500 bg-zinc-200' },
] as const;

export function WorkflowGraphLive({
  graph,
  pending,
  feedback,
  onCommand,
  onBlock,
  onPublish,
}: {
  graph: WorkflowGraph;
  pending: boolean;
  feedback: WriteFeedback | null;
  onCommand: (nodeId: string, command: Exclude<NodeCommand, 'block' | 'publish'>) => void;
  onBlock: (nodeId: string, reason: string | null) => void;
  onPublish: (nodeId: string, draft: PublishDraft) => void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const nodes = useMemo(() => indexWorkflowNodes(graph), [graph]);
  const selected = selectedNodeId ? nodes.get(selectedNodeId) : undefined;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground" data-testid="workflow-live-notice">
        节点状态来自服务器。只显示当前状态允许的操作。回退或不适用如果被拒绝，会显示服务器点名的节点。
      </p>
      <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="流程图图例">
        {LEGEND.map((item) => (
          <li key={item.label} className="flex items-center gap-1.5">
            <span className={cn('size-3 rounded-sm border', item.className)} aria-hidden />
            {item.label}
          </li>
        ))}
      </ul>
      <WriteFeedbackBanner feedback={feedback} />
      <div className="grid gap-4 lg:grid-cols-[1fr_min(16rem,100%)]">
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
          {selected?.apiStatus ? (
            <div className="space-y-3">
              <div>
                <p className="text-base font-medium" data-testid="workflow-detail-name">
                  {selected.name}
                </p>
                <p data-testid="workflow-detail-status">
                  {workflowNodeStatusLabel(selected.status)}
                </p>
                {selected.isOptional ? (
                  <p className="text-xs text-muted-foreground">可选节点</p>
                ) : null}
                {selected.blockingReason ? (
                  <p
                    className="text-xs text-destructive"
                    data-testid="workflow-aside-blocking-reason"
                  >
                    {selected.blockingReason}
                  </p>
                ) : null}
              </div>
              <NodeActionPanel
                key={selected.id}
                status={selected.apiStatus}
                isOptional={selected.isOptional === true}
                isPublishNode={selected.isPublish === true}
                pending={pending}
                onCommand={(command) => onCommand(selected.id, command)}
                onBlock={(reason) => onBlock(selected.id, reason)}
                onPublish={(draft) => onPublish(selected.id, draft)}
              />
            </div>
          ) : (
            <p className="text-muted-foreground">点击节点后，在这里操作它的状态。</p>
          )}
        </aside>
      </div>
    </div>
  );
}
