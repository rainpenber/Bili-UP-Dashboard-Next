import { describe, expect, test } from 'bun:test';
import { advanceToNode, completeNode, rollbackToNode } from './node-lifecycle';

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

  test('complete activates ready parallel successors', () => {
    const nodes = [
      { id: 'a', status: 'completed' },
      { id: 'b1', status: 'in_progress' },
      { id: 'b2', status: 'in_progress' },
      { id: 'c', status: 'not_reached' },
    ];
    const edges = [
      { fromId: 'a', toId: 'b1' },
      { fromId: 'a', toId: 'b2' },
      { fromId: 'b1', toId: 'c' },
      { fromId: 'b2', toId: 'c' },
    ];
    const updates = completeNode('b1', nodes, edges);
    expect(updates.get('b1')?.status).toBe('completed');
    expect(updates.get('c')).toBeUndefined();
    const updates2 = completeNode(
      'b2',
      [...nodes.map((n) => (n.id === 'b1' ? { ...n, status: 'completed' } : n))],
      edges,
    );
    expect(updates2.get('c')?.status).toBe('in_progress');
  });

  test('complete rejects when required predecessors unfinished', () => {
    const nodes = [
      { id: 'a', status: 'completed', name: 'A' },
      { id: 'b1', status: 'not_reached', name: 'B1', isOptional: false },
      { id: 'b2', status: 'not_reached', name: 'B2', isOptional: false },
      { id: 'c', status: 'not_reached', name: 'Review', isOptional: false },
    ];
    const edges = [
      { fromId: 'a', toId: 'b1' },
      { fromId: 'a', toId: 'b2' },
      { fromId: 'b1', toId: 'c' },
      { fromId: 'b2', toId: 'c' },
    ];
    expect(() => completeNode('c', nodes, edges)).toThrow(/predecessor/);
    const mid = [
      { id: 'a', status: 'completed', name: 'A' },
      { id: 'b1', status: 'completed', name: 'B1', isOptional: false },
      { id: 'b2', status: 'not_reached', name: 'B2', isOptional: false },
      { id: 'c', status: 'not_reached', name: 'Review', isOptional: false },
    ];
    expect(() => completeNode('c', mid, edges)).toThrow(/predecessor/);
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
