import { describe, expect, test } from 'bun:test';
import {
  MONITOR_MAX_METRICS_LIMIT,
  newestMetricPoint,
  parseMetricsLimit,
  parseMonitorPage,
  parseMonitorPageSize,
} from './monitor';

describe('monitor query parsers', () => {
  test('page defaults', () => {
    expect(parseMonitorPage(undefined)).toBe(1);
  });

  test('pageSize capped', () => {
    expect(parseMonitorPageSize('999')).toBe(50);
  });

  test('metrics limit capped', () => {
    expect(parseMetricsLimit(String(MONITOR_MAX_METRICS_LIMIT + 1))).toBe(
      MONITOR_MAX_METRICS_LIMIT,
    );
  });
});

describe('newestMetricPoint', () => {
  test('picks the newest timestamp even when an older point has a larger count or is last', () => {
    const older = { sampledAt: '2025-05-17T09:52:00.000Z', viewCount: '40889' };
    const newest = { sampledAt: '2026-10-12T11:09:00.000Z', viewCount: '55300' };
    expect(newestMetricPoint([older, newest])).toEqual(newest);
    expect(newestMetricPoint([newest, older])).toEqual(newest);
    expect(newestMetricPoint([])).toBeUndefined();
  });
});
