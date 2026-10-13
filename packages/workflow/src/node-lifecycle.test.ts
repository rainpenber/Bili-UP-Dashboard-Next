import { describe, expect, test } from 'bun:test';
import { advanceToNode, rollbackToNode } from './node-lifecycle';

describe('node lifecycle parallel', () => {
  test('advance to parallel branch does not complete sibling', () => {
    const nodes = [
      { id: 'a', status: 'completed' },
      { id: 'b1', status: 'not_reached' },
      { id: 'b2', status: 'not_reached' },
      { id: 'c', status: 'not_reached' },
    ];
    const edges = [
      { fromId: 'a', toId: 'b1' },
      { fromId: 'a', toId: 'b2' },
      { fromId: 'b1', toId: 'c' },
      { fromId: 'b2', toId: 'c' },
    ];
    const updates = advanceToNode('b1', nodes, edges);
    expect(updates.get('b1')?.status).toBe('in_progress');
    expect(updates.get('b2')).toBeUndefined();
    expect(nodes.find((n) => n.id === 'a')?.status).toBe('completed');
  });

  test('rollback clears downstream only', () => {
    const edges = [
      { fromId: 'a', toId: 'b' },
      { fromId: 'b', toId: 'c' },
    ];
    const updates = rollbackToNode('b', [{ id: 'b', status: 'completed' }], edges);
    expect(updates.get('c')?.status).toBe('not_reached');
    expect(updates.get('b')?.status).toBe('in_progress');
  });
});
