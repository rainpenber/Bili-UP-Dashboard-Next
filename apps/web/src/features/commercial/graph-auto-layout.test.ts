import { describe, expect, test } from 'bun:test';
import { autoLayoutPositions } from './graph-auto-layout';

describe('autoLayoutPositions', () => {
  test('assigns layers for simple chain', () => {
    const nodes = [
      { id: 'a', posX: 0, posY: 0 },
      { id: 'b', posX: 0, posY: 0 },
    ];
    const edges = [{ fromNodeId: 'a', toNodeId: 'b' }];
    const map = autoLayoutPositions(nodes, edges);
    expect(map.get('a')!.posY).toBeLessThan(map.get('b')!.posY);
  });
});
