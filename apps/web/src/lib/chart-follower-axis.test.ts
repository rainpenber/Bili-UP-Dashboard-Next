import { describe, expect, test } from 'bun:test';
import { followerYAxisBounds } from '@/lib/chart-follower-axis';

describe('followerYAxisBounds', () => {
  test('pads by 300 and clamps at zero', () => {
    expect(followerYAxisBounds([10_000, 10_500])).toEqual({ min: 9700, max: 10_800 });
  });

  test('constant series still spans 600', () => {
    const b = followerYAxisBounds([5000, 5000, 5000]);
    expect(b).toBeDefined();
    expect(b!.max - b!.min).toBeGreaterThanOrEqual(600);
    expect(b!.min).toBeGreaterThanOrEqual(0);
  });

  test('ignores nulls', () => {
    expect(followerYAxisBounds([null, '1000', undefined])).toEqual({ min: 700, max: 1300 });
  });
});
