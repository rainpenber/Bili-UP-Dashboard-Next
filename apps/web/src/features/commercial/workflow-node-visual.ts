import type { WorkflowNodeStatus } from './types';

export function workflowNodeStatusClass(status: WorkflowNodeStatus): string {
  switch (status) {
    case 'done':
      return 'border-success bg-success/30 text-foreground';
    case 'in_progress':
      return 'border-warning bg-warning/35 text-foreground';
    case 'blocked':
      return 'border-destructive bg-destructive/25 text-foreground';
    default:
      return 'border-border bg-muted text-foreground';
  }
}

export function workflowNodeStatusLabel(status: WorkflowNodeStatus): string {
  switch (status) {
    case 'done':
      return '已完成';
    case 'in_progress':
      return '进行中';
    case 'blocked':
      return '被卡住';
    default:
      return '未到';
  }
}

export function includesPostPublishWindDown(graph: {
  steps: { kind: string; nodes?: { id: string; name: string }[] }[];
}): boolean {
  return graph.steps.some(
    (step) =>
      step.kind === 'parallel' &&
      step.nodes?.some((n) => n.id === 'settle' || n.name.includes('结算')),
  );
}
