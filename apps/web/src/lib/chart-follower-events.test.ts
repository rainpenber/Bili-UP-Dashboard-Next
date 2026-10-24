import { describe, expect, test } from 'bun:test';
import type { ResolvedChartColors } from '@/lib/chart-colors';
import {
  buildFollowerOption,
  buildFollowerOptionDetailed,
  FOLLOWER_PUBLISH_SERIES_NAME,
  FOLLOWER_SAMPLE_SERIES_NAME,
  type FollowerChartPublishEvent,
} from '@/lib/chart-config';
import {
  aggregateFollowerEventsByDay,
  FOLLOWER_EVENT_WINDOW_DAYS,
  formatShanghaiDateMinute,
  partitionEventsByWindow,
  shanghaiCalendarDayKey,
} from '@/lib/chart-follower-events';

const COLORS: ResolvedChartColors = {
  background: '#fff',
  foreground: '#111',
  border: '#ccc',
  mutedForeground: '#888',
  series: ['#1a73e8', '#e8710a', '#34a853', '#fbbc04', '#ea4335'],
};

/** Samples only on 2026-10-23 (GOAT-style sparse history). */
const SAMPLES = [
  '2026-10-23T02:00:00.000Z',
  '2026-10-23T04:00:00.000Z',
  '2026-10-23T06:00:00.000Z',
  '2026-10-23T08:00:00.000Z',
];
const FOLLOWERS = [1000, 1010, 1020, 1030];

/** Fixed "now" so the 90-day window is deterministic (≈ 2026-07-25 .. 2026-10-23). */
const NOW_MS = Date.parse('2026-10-23T12:00:00.000Z');

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

describe('shanghaiCalendarDayKey', () => {
  test('uses Asia/Shanghai calendar day', () => {
    // 2026-08-28 13:29 CST = 2026-08-28 05:29 UTC
    expect(shanghaiCalendarDayKey('2026-08-28T05:29:00.000Z')).toBe('2026-08-28');
    // Late UTC evening still next Shanghai morning
    expect(shanghaiCalendarDayKey('2026-08-27T16:30:00.000Z')).toBe('2026-08-28');
  });
});

describe('partitionEventsByWindow', () => {
  test(`keeps events within ${FOLLOWER_EVENT_WINDOW_DAYS} days and counts older ones`, () => {
    const { inWindow, olderCount } = partitionEventsByWindow(
      [
        event({ publishedAt: '2026-05-17T04:00:00.000Z' }),
        event({ publishedAt: '2026-08-14T04:00:00.000Z' }),
        event({ publishedAt: '2026-08-28T05:29:00.000Z' }),
      ],
      NOW_MS,
    );
    expect(olderCount).toBe(1);
    expect(inWindow.map((e) => e.publishedAt)).toEqual([
      '2026-08-14T04:00:00.000Z',
      '2026-08-28T05:29:00.000Z',
    ]);
  });
});

describe('aggregateFollowerEventsByDay', () => {
  test('merges same Shanghai day and keeps first navigable bvid', () => {
    const buckets = aggregateFollowerEventsByDay([
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
    const dayKey = shanghaiCalendarDayKey('2026-10-21T01:00:00.000Z')!;
    const bucket = buckets.get(dayKey);
    expect(bucket?.labels).toEqual([
      `${formatShanghaiDateMinute('2026-10-21T01:00:00.000Z')} 发布了视频《新片》`,
      `${formatShanghaiDateMinute('2026-10-21T02:00:00.000Z')} 发了动态《动态正文》`,
      `${formatShanghaiDateMinute('2026-10-21T03:00:00.000Z')} 发布了视频《另一片》`,
    ]);
    expect(bucket?.navigableExternalId).toBe('BV1aa411c7mA');
    expect(bucket?.xMs).toBe(Date.parse('2026-10-21T01:00:00.000Z'));
  });

  test('unmonitored-only buckets leave navigableExternalId null', () => {
    const buckets = aggregateFollowerEventsByDay([
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
    const dayKey = shanghaiCalendarDayKey('2026-10-21T02:00:00.000Z')!;
    expect(buckets.get(dayKey)?.navigableExternalId).toBeNull();
  });

  test('cross-month events land on distinct real dates (not nearest sample)', () => {
    const buckets = aggregateFollowerEventsByDay([
      event({
        publishedAt: '2026-08-14T06:00:00.000Z',
        titleSnapshot: '八月中',
        externalId: 'BV1aug14xxxxxx',
      }),
      event({
        publishedAt: '2026-08-28T05:29:00.000Z',
        eventKind: 'dynamic',
        titleSnapshot: '抽PS5和GTA6啦!',
        externalId: '1241488471951933462',
        navigable: false,
        monitoredTargetId: null,
      }),
      event({
        publishedAt: '2026-09-01T08:00:00.000Z',
        titleSnapshot: '九月初',
        externalId: 'BV1sep01xxxxxx',
      }),
    ]);
    expect(buckets.size).toBe(3);
    expect(buckets.get('2026-08-14')?.xMs).toBe(Date.parse('2026-08-14T06:00:00.000Z'));
    expect(buckets.get('2026-08-28')?.xMs).toBe(Date.parse('2026-08-28T05:29:00.000Z'));
    expect(buckets.get('2026-09-01')?.xMs).toBe(Date.parse('2026-09-01T08:00:00.000Z'));
    // Must not collapse onto the Oct-23 sample cluster.
    for (const bucket of buckets.values()) {
      expect(bucket.xMs).toBeLessThan(Date.parse('2026-10-01T00:00:00.000Z'));
    }
  });
});

describe('buildFollowerOption publish scatter', () => {
  test('empty events produce no publish scatter / markPoint', () => {
    const option = buildFollowerOption(SAMPLES, FOLLOWERS, COLORS, SAMPLES, 0, 100, [], NOW_MS);
    const series = option.series as { type?: string; name?: string; markPoint?: unknown }[];
    expect(series).toHaveLength(1);
    expect(series[0]?.name).toBe(FOLLOWER_SAMPLE_SERIES_NAME);
    expect(series[0]?.markPoint).toBeUndefined();
    expect(series.some((item) => item.name === FOLLOWER_PUBLISH_SERIES_NAME)).toBe(false);
  });

  test('events become an animation-free scatter with same-day aggregated labels', () => {
    const option = buildFollowerOption(
      SAMPLES,
      FOLLOWERS,
      COLORS,
      SAMPLES,
      0,
      100,
      [
        event({
          publishedAt: '2026-10-23T03:00:00.000Z',
          titleSnapshot: '聚合视频',
          externalId: 'BV1dd411c7mD',
          navigable: true,
        }),
        event({
          publishedAt: '2026-10-23T05:00:00.000Z',
          eventKind: 'dynamic',
          externalId: '9200',
          navigable: false,
          monitoredTargetId: null,
        }),
      ],
      NOW_MS,
    );
    const series = option.series as {
      type?: string;
      name?: string;
      animation?: boolean;
      connectNulls?: boolean;
      markPoint?: unknown;
      data?: {
        value: [number, number];
        eventLabels: string[];
        followerAtEvent: number | null;
        navigableExternalId: string | null;
      }[];
    }[];
    expect(series.some((item) => item.markPoint)).toBe(false);
    const follower = series.find((item) => item.name === FOLLOWER_SAMPLE_SERIES_NAME);
    expect(follower?.connectNulls).toBe(true);
    const publish = series.find((item) => item.name === FOLLOWER_PUBLISH_SERIES_NAME);
    expect(publish?.type).toBe('scatter');
    expect(publish?.animation).toBe(false);
    expect(publish?.data).toHaveLength(1);
    expect(publish?.data?.[0]?.value[0]).toBe(Date.parse('2026-10-23T03:00:00.000Z'));
    // Closest sample to earliest same-day event (03:00): 02:00 and 04:00 tie → first wins.
    expect(publish?.data?.[0]?.followerAtEvent).toBe(1000);
    expect(publish?.data?.[0]?.eventLabels).toEqual([
      `${formatShanghaiDateMinute('2026-10-23T03:00:00.000Z')} 发布了视频《聚合视频》`,
      `${formatShanghaiDateMinute('2026-10-23T05:00:00.000Z')} 发了动态《标题》`,
    ]);
    expect(publish?.data?.[0]?.navigableExternalId).toBe('BV1dd411c7mD');
  });

  test('cross-month events plot at real dates with 无样本 when no follower sample that day', () => {
    const { option, olderEventCount, dayBuckets } = buildFollowerOptionDetailed(
      SAMPLES,
      FOLLOWERS,
      COLORS,
      0,
      100,
      [
        event({
          publishedAt: '2026-05-17T04:00:00.000Z',
          titleSnapshot: '五月更早',
          externalId: 'BV1may17xxxxxx',
        }),
        event({
          publishedAt: '2026-08-14T06:00:00.000Z',
          titleSnapshot: '八月中',
          externalId: 'BV1aug14xxxxxx',
        }),
        event({
          publishedAt: '2026-08-28T05:29:00.000Z',
          eventKind: 'dynamic',
          titleSnapshot: '抽PS5和GTA6啦!',
          externalId: '1241488471951933462',
          navigable: false,
          monitoredTargetId: null,
        }),
      ],
      NOW_MS,
    );
    expect(olderEventCount).toBe(1);
    expect(dayBuckets.size).toBe(2);
    expect(dayBuckets.has('2026-08-14')).toBe(true);
    expect(dayBuckets.has('2026-08-28')).toBe(true);
    expect(dayBuckets.has('2026-05-17')).toBe(false);

    const series = option.series as {
      name?: string;
      data?: {
        value: [number, number];
        followerAtEvent: number | null;
        eventLabels: string[];
      }[];
      markArea?: { data?: unknown[] };
    }[];
    const publish = series.find((item) => item.name === FOLLOWER_PUBLISH_SERIES_NAME);
    expect(publish?.data).toHaveLength(2);
    const xs = (publish?.data ?? []).map((row) => row.value[0]).sort((a, b) => a - b);
    expect(xs[0]).toBe(Date.parse('2026-08-14T06:00:00.000Z'));
    expect(xs[1]).toBe(Date.parse('2026-08-28T05:29:00.000Z'));
    // Must not pile onto the Oct-23 sample index / timestamp cluster.
    expect(xs.every((x) => x < Date.parse('2026-10-01T00:00:00.000Z'))).toBe(true);
    for (const row of publish?.data ?? []) {
      expect(row.followerAtEvent).toBeNull();
    }
    const aug28 = publish?.data?.find(
      (row) => row.value[0] === Date.parse('2026-08-28T05:29:00.000Z'),
    );
    expect(aug28?.eventLabels[0]).toContain('抽PS5和GTA6啦!');
    expect(aug28?.eventLabels[0]).toContain(formatShanghaiDateMinute('2026-08-28T05:29:00.000Z'));

    const follower = series.find((item) => item.name === FOLLOWER_SAMPLE_SERIES_NAME);
    expect(follower?.markArea?.data?.length).toBeGreaterThan(0);

    const xAxis = option.xAxis as { type?: string; min?: number; max?: number };
    expect(xAxis.type).toBe('time');
    expect(xAxis.min).toBe(Date.parse('2026-08-14T06:00:00.000Z'));
    expect(xAxis.max).toBeGreaterThanOrEqual(NOW_MS);
  });
});

describe('follower tooltip sample proximity', () => {
  test('event-only day reports no sample instead of borrowing the nearest sample', () => {
    const now = Date.parse('2026-10-24T00:00:00.000Z');
    const option = buildFollowerOptionDetailed(
      ['2026-10-23T01:00:00.000Z'],
      [34698],
      COLORS,
      0,
      100,
      [
        {
          externalId: '1145141919810',
          eventKind: 'dynamic',
          publishedAt: '2026-08-28T05:29:00.000Z',
          titleSnapshot: '抽PS5和GTA6啦!',
        },
      ],
      now,
    );
    type TipFormatter = (params: unknown) => string;
    const formatter = (option.option.tooltip as { formatter?: TipFormatter }).formatter;
    expect(typeof formatter).toBe('function');

    const eventMs = Date.parse('2026-08-28T05:29:00.000Z');
    const sampleMs = Date.parse('2026-10-23T01:00:00.000Z');
    const farText = formatter?.([
      { seriesName: FOLLOWER_SAMPLE_SERIES_NAME, marker: '', value: [sampleMs, 34698], axisValue: eventMs },
    ]);
    expect(farText).toContain('该时段无采集样本');
    expect(farText).not.toContain('34,698');
    expect(farText).toContain('抽PS5和GTA6啦!');

    const nearText = formatter?.([
      { seriesName: FOLLOWER_SAMPLE_SERIES_NAME, marker: '', value: [sampleMs, 34698], axisValue: sampleMs },
    ]);
    expect(nearText).toContain('34,698');
    expect(nearText).not.toContain('该时段无采集样本');
  });
});
