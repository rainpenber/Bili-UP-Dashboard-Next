import { describe, expect, test } from 'bun:test';
import {
  deriveProjectStage,
  deriveHealthStatus,
  projectExternallyBlockingDownstream,
} from './stage';
import type { WorkflowDependency, WorkflowNodeSnapshot } from './types';

function node(
  partial: Partial<WorkflowNodeSnapshot> & Pick<WorkflowNodeSnapshot, 'id' | 'slug' | 'status'>,
): WorkflowNodeSnapshot {
  return {
    parentId: null,
    sortOrder: 0,
    isRequired: true,
    dependencyMode: 'all_of',
    stageKey: null,
    blockedReason: null,
    ...partial,
  };
}

describe('deriveProjectStage closing items', () => {
  test('stays on settlement when closing open items remain', () => {
    const nodes: WorkflowNodeSnapshot[] = [
      node({ id: '1', slug: 'a', status: 'completed', sortOrder: 10, stageKey: 'business_init' }),
      node({ id: '8', slug: 'z', status: 'completed', sortOrder: 80, stageKey: 'settlement' }),
    ];
    expect(deriveProjectStage(nodes, ['finance'])).toBe('settlement');
    expect(deriveProjectStage(nodes, [])).toBe('completed');
  });
});

describe('deriveHealthStatus external wait', () => {
  test('waiting_external blocking downstream keeps blocked health', () => {
    const nodes: WorkflowNodeSnapshot[] = [
      node({ id: 'a', slug: 'a', status: 'waiting_external', sortOrder: 1 }),
      node({ id: 'b', slug: 'b', status: 'ready', sortOrder: 2 }),
    ];
    const deps: WorkflowDependency[] = [{ nodeId: 'b', dependsOnId: 'a' }];
    expect(projectExternallyBlockingDownstream(nodes, deps)).toBe(true);
    expect(deriveHealthStatus(nodes, deps, false, false)).toBe('blocked');
  });
});
