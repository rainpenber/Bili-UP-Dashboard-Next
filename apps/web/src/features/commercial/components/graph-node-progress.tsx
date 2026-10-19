import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatScheduleLabel } from '../node-schedule';
import { timelineStatusLabel, type TimelineChild } from '../progress-timeline';
import type { LiveGraphNode } from '../workflow-live-graph';
import { toDemoStatus } from '../workflow-status-map';
import { PlanFields, type PlanEditor } from './progress-timeline-view';
import { NodeStepActions, PlanEditButton, type StepController } from './stage-step-controls';

function childFromLive(node: LiveGraphNode): TimelineChild {
  const status = node.status ?? 'not_reached';
  const reason =
    status === 'blocked' && node.blockingReason && node.blockingReason.trim().length > 0
      ? node.blockingReason
      : null;
  return {
    id: node.id,
    nodeId: node.templateSlug && node.templateSlug.length > 0 ? node.templateSlug : node.id,
    name: node.name,
    status,
    demoStatus: toDemoStatus(status),
    statusLabel: timelineStatusLabel(status),
    blockingReason: reason,
    plannedAt: node.plannedAt ?? null,
    completedAt: node.completedAt ?? null,
    updatedAt: node.updatedAt ?? null,
  };
}

function GraphStepError({ controller }: { controller: StepController }) {
  if (!controller.error) return null;
  return (
    <div className="mt-2 space-y-1" role="alert" data-testid="graph-step-error">
      <p className="text-xs break-words text-destructive">{controller.error}</p>
      {controller.successors.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {controller.successors.map((item) => (
            <Button
              key={item.nodeId}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              data-testid={`graph-step-locate-${item.nodeId}`}
              onClick={() => controller.locate(item.templateSlug)}
              onPointerDown={(event) => event.stopPropagation()}
            >
              查看{item.nodeName}
            </Button>
          ))}
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        data-testid="graph-step-refresh"
        onClick={() => controller.refresh()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        刷新后重试
      </Button>
    </div>
  );
}

/** Expanded instance card: the same facts and step controls as the timeline. */
export function GraphNodeProgress({
  node,
  interactive,
  step,
  planEditor,
}: {
  node: LiveGraphNode;
  interactive: boolean;
  step: StepController;
  planEditor: PlanEditor;
}) {
  const child = childFromLive(node);
  const [editingPlan, setEditingPlan] = useState(false);
  const planLabel = node.plannedAt ? formatScheduleLabel(node.plannedAt) : null;
  const actualLabel = node.completedAt ? formatScheduleLabel(node.completedAt) : null;
  const showError = step.subjectNodeId === node.id && Boolean(step.error);
  return (
    <div data-testid="graph-node-progress" data-node-id={node.id} data-status={child.status}>
      <p data-testid="graph-node-status-word">{child.statusLabel}</p>
      {child.status === 'blocked' ? (
        <p className="mt-1 break-words" data-testid="graph-node-reason">
          {child.blockingReason ?? '尚未记录原因'}
        </p>
      ) : null}
      {planLabel || actualLabel ? (
        <p className="mt-1 flex flex-wrap gap-x-2 break-words">
          {planLabel ? <span>计划 {planLabel}</span> : null}
          {actualLabel ? (
            <span data-testid="graph-node-completed-at">实际 {actualLabel}</span>
          ) : null}
        </p>
      ) : null}
      {interactive && !planEditor.disabled ? (
        <PlanEditButton
          name={child.name}
          nodeId={child.nodeId}
          onOpen={() => setEditingPlan(true)}
        />
      ) : null}
      {interactive && !planEditor.disabled && editingPlan ? (
        <PlanFields child={child} editor={planEditor} />
      ) : null}
      {interactive ? <NodeStepActions child={child} controller={step} /> : null}
      {showError ? <GraphStepError controller={step} /> : null}
    </div>
  );
}
