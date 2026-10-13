import type { NodeStatus } from './types';

const ALLOWED: Record<NodeStatus, readonly NodeStatus[]> = {
  locked: [],
  ready: ['in_progress', 'skipped'],
  in_progress: ['waiting_external', 'blocked', 'completed', 'ready'],
  waiting_external: ['in_progress', 'blocked', 'completed'],
  blocked: ['in_progress', 'ready'],
  completed: ['in_progress'],
  skipped: ['in_progress'],
};

export function allowedNodeTransitions(from: NodeStatus): readonly NodeStatus[] {
  return [...ALLOWED[from], from];
}

export function assertValidNodeTransition(from: NodeStatus, to: NodeStatus): void {
  if (from === to) return;
  if (from === 'locked') {
    throw new TransitionError('locked 节点需等待依赖满足后自动开放');
  }
  const allowed = ALLOWED[from];
  if (!allowed.includes(to)) {
    throw new TransitionError(`不允许从 ${from} 变更为 ${to}`);
  }
}

export class TransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

export function isDependencySatisfied(
  mode: 'all_of' | 'any_of',
  predecessorStatuses: NodeStatus[],
): boolean {
  if (predecessorStatuses.length === 0) return true;
  const done = (s: NodeStatus) => s === 'completed' || s === 'skipped';
  if (mode === 'any_of') return predecessorStatuses.some(done);
  return predecessorStatuses.every(done);
}
