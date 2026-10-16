import { describe, expect, test } from 'bun:test';
import { nudgeOverlaps, type OverlapBox } from './overlap';

function box(id: string, x: number, y: number, w: number, h: number, anchor = false): OverlapBox {
  return { id, x, y, w, h, anchor };
}

describe('nudgeOverlaps', () => {
  test('pushes a covered neighbor out and leaves distant nodes', () => {
    const nudge = nudgeOverlaps(
      [
        box('open', 100, 0, 160, 180, true),
        box('below', 120, 150, 120, 36),
        box('far', 800, 40, 120, 36),
      ],
      14,
    );
    expect(nudge.open).toBeUndefined();
    expect(nudge.far).toBeUndefined();
    expect(nudge.below!.y).toBeGreaterThan(0);
    const movedTop = 150 + nudge.below!.y;
    expect(movedTop).toBeGreaterThanOrEqual(180 + 14 - 0.5);
  });

  test('returns nothing when nothing is expanded', () => {
    expect(nudgeOverlaps([box('a', 0, 0, 100, 36), box('b', 0, 80, 100, 36)])).toEqual({});
  });

  test('pushes upward when the neighbor sits above the expanded card', () => {
    const nudge = nudgeOverlaps(
      [box('open', 0, 100, 140, 160, true), box('above', 10, 80, 120, 36)],
      10,
    );
    expect(nudge.above!.y).toBeLessThan(0);
    const movedBottom = 80 + 36 + nudge.above!.y;
    expect(movedBottom).toBeLessThanOrEqual(100 - 10 + 0.5);
  });
});
