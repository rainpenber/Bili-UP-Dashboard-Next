import { describe, expect, test } from 'bun:test';
import {
  MONITOR_CREATOR_VIDEOS_DEFAULT_LIMIT,
  MONITOR_CREATOR_VIDEOS_MAX_LIMIT,
  MONITOR_MAX_METRICS_LIMIT,
  newestMetricPoint,
  parseCreatorMid,
  parseCreatorVideosLimit,
  parseCreatorVideosOffset,
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

  test('creator video limit defaults to 20 and caps at 100', () => {
    expect(parseCreatorVideosLimit(undefined)).toBe(MONITOR_CREATOR_VIDEOS_DEFAULT_LIMIT);
    expect(parseCreatorVideosLimit('1')).toBe(1);
    expect(parseCreatorVideosLimit('100')).toBe(100);
    expect(parseCreatorVideosLimit('101')).toBe(MONITOR_CREATOR_VIDEOS_MAX_LIMIT);
    expect(parseCreatorVideosLimit('1000')).toBe(MONITOR_CREATOR_VIDEOS_MAX_LIMIT);
    expect(() => parseCreatorVideosLimit('0')).toThrow(/invalid limit/);
    expect(() => parseCreatorVideosLimit('-1')).toThrow(/invalid limit/);
    expect(() => parseCreatorVideosLimit('nope')).toThrow(/invalid limit/);
  });

  test('creator video offset rejects negatives', () => {
    expect(parseCreatorVideosOffset(undefined)).toBe(0);
    expect(parseCreatorVideosOffset('0')).toBe(0);
    expect(parseCreatorVideosOffset('20')).toBe(20);
    expect(parseCreatorVideosOffset('20.9')).toBe(20);
    expect(() => parseCreatorVideosOffset('-1')).toThrow(/invalid offset/);
    expect(() => parseCreatorVideosOffset('nope')).toThrow(/invalid offset/);
  });

  test('creator mid accepts bigint digits only', () => {
    expect(parseCreatorMid('3493141386627335')).toBe('3493141386627335');
    expect(parseCreatorMid('0007')).toBe('7');
    expect(() => parseCreatorMid('')).toThrow(/invalid mid/);
    expect(() => parseCreatorMid('12a')).toThrow(/invalid mid/);
    expect(() => parseCreatorMid('9999999999999999999')).toThrow(/invalid mid/);
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
