import { describe, expect, test } from 'bun:test';
import { assertValidNodeTransition, TransitionError } from './node-transitions';
import { recomputeAfterManualChange } from './recompute';
import { deriveProjectStage } from './stage';
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

describe('node transitions', () => {
  test('rejects invalid transition with readable error', () => {
    expect(() => assertValidNodeTransition('ready', 'completed')).toThrow(TransitionError);
  });

  test('all_of waits for all predecessors', () => {
    const nodes: WorkflowNodeSnapshot[] = [
      node({ id: 'a', slug: 'a', status: 'completed', sortOrder: 1, stageKey: 'business_init' }),
      node({ id: 'b', slug: 'b', status: 'locked', sortOrder: 2, stageKey: 'outline' }),
    ];
    const deps: WorkflowDependency[] = [{ nodeId: 'b', dependsOnId: 'a' }];
    const { statusUpdates } = recomputeAfterManualChange(nodes, deps);
    expect(statusUpdates.get('b')).toBe('ready');
  });

  test('any_of opens when one predecessor completes', () => {
    const nodes: WorkflowNodeSnapshot[] = [
      node({
        id: 'a',
        slug: 'a',
        status: 'skipped',
        sortOrder: 1,
        dependencyMode: 'any_of',
      }),
      node({
        id: 'b',
        slug: 'b',
        status: 'locked',
        sortOrder: 2,
        dependencyMode: 'any_of',
      }),
      node({
        id: 'c',
        slug: 'c',
        status: 'locked',
        sortOrder: 3,
        dependencyMode: 'any_of',
      }),
    ];
    const deps: WorkflowDependency[] = [
      { nodeId: 'c', dependsOnId: 'a' },
      { nodeId: 'c', dependsOnId: 'b' },
    ];
    nodes[2] = { ...nodes[2]!, dependencyMode: 'any_of' };
    const { statusUpdates } = recomputeAfterManualChange(nodes, deps);
    expect(statusUpdates.get('c')).toBe('ready');
  });

  test('derive stage stays on current incomplete stage', () => {
    const nodes: WorkflowNodeSnapshot[] = [
      node({
        id: '1',
        slug: 'business_init',
        status: 'completed',
        sortOrder: 10,
        stageKey: 'business_init',
      }),
      node({ id: '2', slug: 'outline', status: 'in_progress', sortOrder: 20, stageKey: 'outline' }),
      node({
        id: '3',
        slug: 'copywriting',
        status: 'locked',
        sortOrder: 30,
        stageKey: 'copywriting',
      }),
    ];
    expect(deriveProjectStage(nodes)).toBe('outline');
  });
});
