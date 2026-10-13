import { describe, expect, test } from 'bun:test';
import { defaultDataZoomRange } from '@/lib/chart-window';
import { formatShortTime, formatFullLocalTime } from '@/lib/format-time';

describe('formatShortTime', () => {
  test('relative buckets', () => {
    const now = Date.parse('2025-06-15T12:00:00.000Z');
    expect(formatShortTime('2025-06-15T11:59:30.000Z', now)).toBe('刚刚');
    expect(formatShortTime('2025-06-15T11:00:00.000Z', now)).toMatch(/分钟前|小时前/);
  });
});

describe('formatFullLocalTime', () => {
  test('returns localized string', () => {
    const out = formatFullLocalTime('2025-01-02T03:04:05.000Z');
    expect(out).toContain('2025');
  });
});

describe('defaultDataZoomRange', () => {
  test('shows last 30 days when more data exists', () => {
    const times: string[] = [];
    const start = Date.parse('2024-01-01T00:00:00.000Z');
    for (let i = 0; i <= 45; i++) {
      times.push(new Date(start + i * 86_400_000).toISOString());
    }
    const zoom = defaultDataZoomRange(times);
    expect(zoom.end).toBe(100);
    expect(zoom.start).toBeGreaterThan(0);
  });

  test('empty and single point', () => {
    expect(defaultDataZoomRange([])).toEqual({ start: 0, end: 100 });
    expect(defaultDataZoomRange(['2025-01-01T00:00:00.000Z'])).toEqual({ start: 0, end: 100 });
  });
});
