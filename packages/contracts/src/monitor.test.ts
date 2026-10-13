import { describe, expect, test } from 'bun:test';
import {
  MONITOR_MAX_METRICS_LIMIT,
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
