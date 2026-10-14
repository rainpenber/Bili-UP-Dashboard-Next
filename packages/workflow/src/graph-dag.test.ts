import { describe, expect, test } from 'bun:test';
import { canCompleteNode, detectCycle } from './graph-dag';

describe('graph dag', () => {
  test('detects cycle', () => {
    const err = detectCycle(
      [
        { id: 'a', status: 'in_progress' },
        { id: 'b', status: 'not_reached' },
      ],
      [
        { fromId: 'a', toId: 'b' },
        { fromId: 'b', toId: 'a' },
      ],
    );
    expect(err).toBe('cycle detected');
  });

  test('requires predecessors complete', () => {
    const nodes = [
      { id: 'a', status: 'in_progress' },
      { id: 'b', status: 'not_reached' },
    ];
    const edges = [{ fromId: 'a', toId: 'b' }];
    expect(canCompleteNode('b', nodes, edges).ok).toBe(false);
    nodes[0]!.status = 'completed';
    expect(canCompleteNode('b', nodes, edges).ok).toBe(true);
  });
});
