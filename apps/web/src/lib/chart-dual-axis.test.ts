import { describe, expect, test } from 'bun:test';
import { formatViewCountThousandsFromRaw } from '@/lib/format-view-thousands';

describe('dual axis view scaling', () => {
  test('displays views in thousands while preserving raw', () => {
    const views = 2_345_678;
    const scaled = views / 1000;
    expect(scaled).toBe(2345.678);
    expect(views).toBe(Math.round(scaled * 1000));
  });

  test('tooltip thousand suffix matches dedicated formatter', () => {
    expect(formatViewCountThousandsFromRaw(999)).toBe('0.999');
    expect(formatViewCountThousandsFromRaw(10)).toBe('0.01');
  });
});
