import type { CommercialBusinessState, WfNodeStatus } from '@studio/contracts';
import type { DerivedTimeline, TimelineSourceNode } from './progress-timeline';
import { timelineStatusLabel } from './progress-timeline';
import { toDemoStatus } from './workflow-status-map';
import type { LiveGraphNode } from './workflow-live-graph';

/** Visual-only node status overlay. Does not mutate stored workflow rows. */
export function displayNodeStatusForBusinessState(
  status: WfNodeStatus | string,
  businessState: CommercialBusinessState | null | undefined,
): string {
  if (businessState === 'finished') return 'completed';
  if (businessState === 'not_started') return 'not_reached';
  return status;
}

export function applyBusinessStateToTimelineNodes(
  nodes: TimelineSourceNode[],
  businessState: CommercialBusinessState | null | undefined,
): TimelineSourceNode[] {
  if (businessState !== 'finished' && businessState !== 'not_started') return nodes;
  return nodes.map((node) => ({
    ...node,
    status: displayNodeStatusForBusinessState(node.status, businessState),
    blockingReason: null,
  }));
}

export function applyBusinessStateToLiveNodes(
  nodes: LiveGraphNode[],
  businessState: CommercialBusinessState | null | undefined,
): LiveGraphNode[] {
  if (businessState !== 'finished' && businessState !== 'not_started') return nodes;
  return nodes.map((node) => ({
    ...node,
    status: displayNodeStatusForBusinessState(
      node.status ?? 'not_reached',
      businessState,
    ) as LiveGraphNode['status'],
    blockingReason: null,
  }));
}

export function businessStateOverallStageLabel(
  businessState: CommercialBusinessState | null | undefined,
  fallback: string,
): string {
  if (businessState === 'finished') return '已结束';
  if (businessState === 'not_started') return '未开始';
  return fallback;
}

export function isBusinessStateReadOnly(
  businessState: CommercialBusinessState | null | undefined,
): boolean {
  return businessState === 'finished' || businessState === 'not_started';
}

export function businessStateListBadge(
  businessState: CommercialBusinessState | null | undefined,
  originStatusLabel: string | null | undefined,
): { tone: 'finished' | 'not_started'; text: string } | null {
  if (businessState !== 'finished' && businessState !== 'not_started') return null;
  const label = originStatusLabel && originStatusLabel.length > 0 ? originStatusLabel : null;
  if (businessState === 'finished') {
    return {
      tone: 'finished',
      text: label ? `已结束 · ${label}` : '已结束',
    };
  }
  return {
    tone: 'not_started',
    text: label ? `未开始 · ${label}` : '未开始',
  };
}

/**
 * Force every timeline stage/point into finished green or not-started grey,
 * including empty stages that would otherwise stay not_reached after node overlay.
 */
export function applyBusinessStateToDerivedTimeline(
  timeline: DerivedTimeline,
  businessState: CommercialBusinessState | null | undefined,
): DerivedTimeline {
  if (businessState !== 'finished' && businessState !== 'not_started') return timeline;
  const status = businessState === 'finished' ? 'completed' : 'not_reached';
  const demoStatus = toDemoStatus(status);
  const statusLabel = timelineStatusLabel(status);
  return {
    points: timeline.points.map((point) => ({
      ...point,
      status,
      demoStatus,
    })),
    stages: timeline.stages.map((stage) => ({
      ...stage,
      status,
      demoStatus,
      current: false,
      blockers: [],
      children: stage.children.map((child) => ({
        ...child,
        status,
        demoStatus,
        statusLabel,
        blockingReason: null,
      })),
    })),
  };
}
