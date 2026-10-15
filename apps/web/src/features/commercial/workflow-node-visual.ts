import type { WorkflowNodeStatus } from './types';

/** Opaque tints (light theme) — contrast pairs verified in workflow-node-contrast.test.ts */
export const WORKFLOW_STATUS_SURFACE = {
  done: {
    card: 'border-emerald-600 bg-emerald-100',
    title: 'text-emerald-950',
    status: 'text-emerald-900',
  },
  in_progress: {
    card: 'border-amber-600 bg-amber-100',
    title: 'text-amber-950',
    status: 'text-amber-900',
  },
  blocked: {
    card: 'border-red-600 bg-red-100',
    title: 'text-red-950',
    status: 'text-red-900',
  },
  not_reached: {
    card: 'border-zinc-400 bg-zinc-100',
    title: 'text-zinc-900',
    status: 'text-zinc-800',
  },
  not_applicable: {
    card: 'border-zinc-500 bg-zinc-200',
    title: 'text-zinc-950',
    status: 'text-zinc-900',
  },
} as const;

function surfaceFor(status: WorkflowNodeStatus) {
  if (status === 'done') return WORKFLOW_STATUS_SURFACE.done;
  if (status === 'in_progress') return WORKFLOW_STATUS_SURFACE.in_progress;
  if (status === 'blocked') return WORKFLOW_STATUS_SURFACE.blocked;
  if (status === 'not_applicable') return WORKFLOW_STATUS_SURFACE.not_applicable;
  return WORKFLOW_STATUS_SURFACE.not_reached;
}

export function workflowNodeStatusClass(status: WorkflowNodeStatus): string {
  const surface = surfaceFor(status);
  return `${surface.card} ${surface.title}`;
}

export function workflowNodeStatusTextClass(status: WorkflowNodeStatus): string {
  return surfaceFor(status).status;
}

export function workflowNodeStatusLabel(status: WorkflowNodeStatus): string {
  switch (status) {
    case 'done':
      return '已完成';
    case 'in_progress':
      return '进行中';
    case 'blocked':
      return '被卡住';
    case 'not_applicable':
      return '不适用';
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
