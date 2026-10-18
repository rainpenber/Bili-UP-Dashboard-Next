import type { WfNodeStatus } from '@studio/contracts';
import type { MockStatus } from '../workflow-mock/flow-nodes';
import type { WorkflowNodeStatus } from './types';

/**
 * Demo four-cell palette. `not_applicable` has no fifth cell, so it shares the
 * neutral 「未完成」 color and is marked on the card via `data-workflow-status`.
 */
export const DEMO_STATUS_COLOR: Record<MockStatus, string> = {
  done: '#15803d',
  active: '#1d4ed8',
  blocked: '#c2410c',
  idle: '#6b7280',
};

export function toDemoStatus(status: WorkflowNodeStatus | WfNodeStatus | string): MockStatus {
  switch (status) {
    case 'done':
    case 'completed':
      return 'done';
    case 'in_progress':
      return 'active';
    case 'blocked':
      return 'blocked';
    case 'not_applicable':
    case 'not_reached':
    default:
      return 'idle';
  }
}
