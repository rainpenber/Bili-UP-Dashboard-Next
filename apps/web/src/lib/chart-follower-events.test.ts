import { describe, expect, test } from 'bun:test';
import type { ResolvedChartColors } from '@/lib/chart-colors';
import {
  aggregateFollowerEvents,
  buildFollowerOption,
  FOLLOWER_PUBLISH_SERIES_NAME,
  type FollowerChartPublishEvent,
} from '@/lib/chart-config';

const COLORS: ResolvedChartColors = {
  background: '#fff',
  foreground: '#111',
  border: '#ccc',
  mutedForeground: '#888',
  series: ['#1a73e8', '#e8710a', '#34a853', '#fbbc04', '#ea4335'],
};

const SAMPLES = [
  '2026-10-20T00:00:00.000Z',
  '2026-10-21T00:00:00.000Z',
  '2026-10-22T00:00:00.000Z',
];

function event(patch: Partial<FollowerChartPublishEvent>): FollowerChartPublishEvent {
  return {
    publishedAt: '2026-10-21T02:00:00.000Z',
    eventKind: 'video',
    titleSnapshot: '标题',
    externalId: 'BV1xx411c7mD',
    navigable: true,
    monitoredTargetId: '11111111-1111-4111-8111-111111111111',
    ...patch,
  };
}

describe('aggregateFollowerEvents', () => {
  test('merges same-bucket video and dynamic labels and keeps first navigable bvid', () => {
    // All timestamps nearest to sample index 1 (2026-10-21T00:00Z).
    const buckets = aggregateFollowerEvents(SAMPLES, [
      event({
        publishedAt: '2026-10-21T01:00:00.000Z',
        eventKind: 'video',
        titleSnapshot: '新片',
        externalId: 'BV1aa411c7mA',
        navigable: true,
      }),
      event({
        publishedAt: '2026-10-21T02:00:00.000Z',
        eventKind: 'dynamic',
        titleSnapshot: '动态正文',
        externalId: '9001',
        navigable: false,
        monitoredTargetId: null,
      }),
      event({
        publishedAt: '2026-10-21T03:00:00.000Z',
        eventKind: 'video',
        titleSnapshot: '另一片',
        externalId: 'BV1bb411c7mB',
        navigable: true,
      }),
    ]);
    expect(buckets.size).toBe(1);
    const bucket = buckets.get(1);
    expect(bucket?.labels).toEqual([
      '发布了视频《新片》',
      '发了动态《动态正文》',
      '发布了视频《另一片》',
    ]);
    // First navigable video wins; unmonitored dynamic must not overwrite.
    expect(bucket?.navigableExternalId).toBe('BV1aa411c7mA');
  });

  test('unmonitored-only buckets leave navigableExternalId null', () => {
    const buckets = aggregateFollowerEvents(SAMPLES, [
      event({
        eventKind: 'video',
        titleSnapshot: '未监控',
        externalId: 'BV1cc411c7mC',
        navigable: false,
        monitoredTargetId: null,
      }),
      event({
        eventKind: 'dynamic',
        externalId: '9100',
        navigable: false,
        monitoredTargetId: null,
      }),
    ]);
    expect(buckets.get(1)?.navigableExternalId).toBeNull();
    expect(buckets.get(1)?.labels).toEqual(['发布了视频《未监控》', '发了动态《标题》']);
  });
});

describe('buildFollowerOption publish scatter', () => {
  test('empty events produce no publish scatter / markPoint', () => {
    const option = buildFollowerOption(SAMPLES, [100, 110, 120], COLORS, SAMPLES, 0, 2, []);
    const series = option.series as { type?: string; name?: string; markPoint?: unknown }[];
    expect(series).toHaveLength(1);
    expect(series[0]?.name).toBe('粉丝数');
    expect(series[0]?.markPoint).toBeUndefined();
    expect(series.some((item) => item.name === FOLLOWER_PUBLISH_SERIES_NAME)).toBe(false);
  });

  test('events become an animation-free scatter with aggregated labels', () => {
    const option = buildFollowerOption(SAMPLES, [100, 110, 120], COLORS, SAMPLES, 0, 2, [
      event({
        publishedAt: '2026-10-21T01:00:00.000Z',
        titleSnapshot: '聚合视频',
        externalId: 'BV1dd411c7mD',
        navigable: true,
      }),
      event({
        publishedAt: '2026-10-21T02:00:00.000Z',
        eventKind: 'dynamic',
        externalId: '9200',
        navigable: false,
        monitoredTargetId: null,
      }),
    ]);
    const series = option.series as {
      type?: string;
      name?: string;
      animation?: boolean;
      markPoint?: unknown;
      data?: {
        value: [number, number];
        eventLabels: string[];
        navigableExternalId: string | null;
      }[];
    }[];
    expect(series.some((item) => item.markPoint)).toBe(false);
    const publish = series.find((item) => item.name === FOLLOWER_PUBLISH_SERIES_NAME);
    expect(publish?.type).toBe('scatter');
    expect(publish?.animation).toBe(false);
    expect(publish?.data).toHaveLength(1);
    expect(publish?.data?.[0]?.value).toEqual([1, 110]);
    expect(publish?.data?.[0]?.eventLabels).toEqual([
      '发布了视频《聚合视频》',
      '发了动态《标题》',
    ]);
    expect(publish?.data?.[0]?.navigableExternalId).toBe('BV1dd411c7mD');
  });
});
