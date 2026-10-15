import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { WorkflowFlowNodeData } from '../workflow-graph-flow-layout';
import {
  workflowNodeStatusClass,
  workflowNodeStatusLabel,
  workflowNodeStatusTextClass,
} from '../workflow-node-visual';

const handleClass =
  '!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0 pointer-events-none';

export function WorkflowFlowNode({ data, id }: NodeProps<Node<WorkflowFlowNodeData>>) {
  const { wfNode, expanded, selected, onNodeActivate, editor } = data;
  const cardRef = useRef<HTMLDivElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      updateNodeInternals(id);
    });
    ro.observe(el);
    updateNodeInternals(id);
    return () => ro.disconnect();
  }, [id, expanded, wfNode.status, wfNode.blockingReason, updateNodeInternals]);

  const showEditor = expanded && editor != null;

  return (
    <div className="relative" ref={cardRef}>
      <Handle type="target" position={Position.Top} id="target" className={handleClass} />
      <Card
        className={cn(
          'w-[11rem] cursor-pointer border-2 shadow-sm transition-shadow',
          workflowNodeStatusClass(wfNode.status),
          (expanded || selected) && 'ring-2 ring-ring/40',
        )}
        data-workflow-node={wfNode.id}
        data-workflow-status={wfNode.status}
        data-blocking-reason={wfNode.blockingReason ?? undefined}
        onClick={(event) => {
          event.stopPropagation();
          onNodeActivate?.(id);
        }}
      >
        <CardContent className="p-2">
          <p className="text-sm font-semibold leading-snug text-foreground">{wfNode.name}</p>
          <p
            className={cn('text-xs font-medium', workflowNodeStatusTextClass(wfNode.status))}
            data-testid={`workflow-node-status-${wfNode.id}`}
          >
            {workflowNodeStatusLabel(wfNode.status)}
          </p>
          {expanded ? (
            <div className="mt-2 space-y-2 text-xs text-foreground/85">
              {wfNode.plannedDateLabel ? <p>计划：{wfNode.plannedDateLabel}</p> : null}
              {wfNode.finishedDateLabel ? <p>完成：{wfNode.finishedDateLabel}</p> : null}
              {wfNode.blockingReason ? (
                <p className="text-destructive" data-testid="workflow-detail-blocking-reason">
                  {wfNode.blockingReason}
                </p>
              ) : null}
              {showEditor ? (
                <div
                  className="flex flex-col gap-1.5 border-t border-border/60 pt-2"
                  data-testid="workflow-node-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  {wfNode.status === 'not_reached' ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => editor.onStart?.()}
                      data-testid="workflow-start"
                    >
                      进行中
                    </Button>
                  ) : null}
                  {wfNode.status === 'in_progress' ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => editor.onComplete?.()}
                        data-testid="workflow-complete"
                      >
                        完成
                      </Button>
                      <Input
                        value={editor.blockReasonDraft ?? ''}
                        onChange={(e) => editor.setBlockReasonDraft?.(e.target.value)}
                        placeholder="阻塞原因（可选）"
                        className="h-7 text-xs"
                        data-testid="workflow-block-reason-input"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        onClick={() => editor.onBlock?.(editor.blockReasonDraft ?? '')}
                        data-testid="workflow-block-submit"
                      >
                        标记阻塞
                      </Button>
                    </>
                  ) : null}
                  {wfNode.status === 'blocked' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => editor.onClearBlock?.()}
                      data-testid="workflow-clear-block"
                    >
                      解除阻塞
                    </Button>
                  ) : null}
                  {wfNode.status !== 'not_reached' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 text-xs"
                      onClick={() => editor.onRollback?.()}
                      data-testid="workflow-rollback"
                    >
                      回退
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Handle type="source" position={Position.Bottom} id="source" className={handleClass} />
    </div>
  );
}
