import { describe, expect, test } from 'bun:test';
import {
  formatViewCountThousandsFromRaw,
  formatViewCountThousandsUnit,
} from '@/lib/format-view-thousands';

describe('formatViewCountThousandsUnit', () => {
  test('sub-unit values keep distinguishing decimals', () => {
    expect(formatViewCountThousandsUnit(0.01)).toBe('0.01');
    expect(formatViewCountThousandsUnit(0.1)).toBe('0.1');
    expect(formatViewCountThousandsUnit(0.5)).toBe('0.5');
    expect(formatViewCountThousandsUnit(0.999)).toBe('0.999');
  });

  test('at and above one thousand plays', () => {
    expect(formatViewCountThousandsUnit(1)).toBe('1');
    expect(formatViewCountThousandsUnit(10)).toBe('10');
    expect(formatViewCountThousandsUnit(500)).toBe('500');
    expect(formatViewCountThousandsUnit(1234.5)).toBe('1234.5');
  });

  test('from raw play counts', () => {
    expect(formatViewCountThousandsFromRaw(10)).toBe('0.01');
    expect(formatViewCountThousandsFromRaw(100)).toBe('0.1');
    expect(formatViewCountThousandsFromRaw(500)).toBe('0.5');
    expect(formatViewCountThousandsFromRaw(999)).toBe('0.999');
    expect(formatViewCountThousandsFromRaw(1000)).toBe('1');
    expect(formatViewCountThousandsFromRaw(1_234_567)).toBe('1234.57');
    expect(formatViewCountThousandsFromRaw(10_000_000)).toBe('1万');
  });

  test('does not collapse distinct sub-unit ticks to zero', () => {
    const labels = [0.01, 0.02, 0.05, 0.1].map((v) => formatViewCountThousandsUnit(v));
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((l) => l !== '0')).toBe(true);
  });
});
