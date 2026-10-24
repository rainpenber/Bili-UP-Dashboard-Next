import { describe, expect, test } from 'bun:test';
import type { ResolvedChartColors } from '@/lib/chart-colors';
import {
  buildFollowerOption,
  buildFollowerOptionDetailed,
  FOLLOWER_EVENT_SYMBOL_SIZE,
  FOLLOWER_PUBLISH_SERIES_NAME,
  FOLLOWER_SAMPLE_SERIES_NAME,
  type FollowerChartPublishEvent,
} from '@/lib/chart-config';
import {
  aggregateFollowerEventsByDay,
  FOLLOWER_EVENT_WINDOW_DAYS,
  formatShanghaiDateMinute,
  partitionEventsBySampleRange,
  partitionEventsByWindow,
  shanghaiCalendarDayKey,
} from '@/lib/chart-follower-events';
import { defaultFollowerZoomRange } from '@/lib/chart-window';

const COLORS: ResolvedChartColors = {
  background: '#fff',
  foreground: '#111',
  border: '#ccc',
  mutedForeground: '#888',
  series: ['#1a73e8', '#e8710a', '#fbbc04', '#34a853', '#9c27b0'],
};

/** Samples only on 2026-10-23 (GOAT-style sparse history). */
const SAMPLES = [
  '2026-10-23T02:00:00.000Z',
  '2026-10-23T04:00:00.000Z',
  '2026-10-23T06:00:00.000Z',
  '2026-10-23T08:00:00.000Z',
];
const FOLLOWERS = [1000, 1010, 1020, 1030];

/** Fixed "now" so windows are deterministic. */
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

describe('partitionEventsBySampleRange', () => {
  test('keeps only events inside the sample span', () => {
    const sampleTimes = SAMPLES.map((iso) => Date.parse(iso));
    const { inRange, outsideCount } = partitionEventsBySampleRange(
      [
        event({ publishedAt: '2026-08-28T05:29:00.000Z' }),
        event({ publishedAt: '2026-10-23T03:00:00.000Z' }),
        event({ publishedAt: '2026-10-23T09:00:00.000Z' }),
      ],
      sampleTimes,
    );
    expect(outsideCount).toBe(2);
    expect(inRange.map((e) => e.publishedAt)).toEqual(['2026-10-23T03:00:00.000Z']);
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
    expect(bucket?.navHref).toBe('/monitoring/videos/BV1aa411c7mA');
    expect(bucket?.items[1]?.navHref).toBe('/monitoring/dynamics/9001');
    expect(bucket?.xMs).toBe(Date.parse('2026-10-21T01:00:00.000Z'));
  });

  test('unmonitored-only buckets leave navigableExternalId null but dynamics stay linkable', () => {
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
    expect(buckets.get(dayKey)?.navHref).toBe('/monitoring/dynamics/9100');
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

describe('defaultFollowerZoomRange', () => {
  test('defaults to last 90 days of a multi-year domain', () => {
    const minMs = Date.parse('2023-01-01T00:00:00.000Z');
    const maxMs = Date.parse('2026-10-23T12:00:00.000Z');
    const lastSample = Date.parse('2026-10-23T08:00:00.000Z');
    const zoom = defaultFollowerZoomRange(minMs, maxMs, lastSample);
    expect(zoom.end).toBe(100);
    expect(zoom.start).toBeGreaterThan(70);
    expect(zoom.start).toBeLessThan(100);
  });

  test('shows full domain when shorter than 90 days', () => {
    const minMs = Date.parse('2026-10-01T00:00:00.000Z');
    const maxMs = Date.parse('2026-10-23T12:00:00.000Z');
    expect(defaultFollowerZoomRange(minMs, maxMs, maxMs)).toEqual({ start: 0, end: 100 });
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

  test('events become hollow animation-free scatter with same-day aggregated labels', () => {
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
          coverProxyUrl: '/api/v1/assets/cover-1',
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
      symbolSize?: number;
      markPoint?: unknown;
      itemStyle?: { color?: string; borderColor?: string; borderWidth?: number };
      data?: {
        value: [number, number];
        eventLabels: string[];
        followerAtEvent: number | null;
        navigableExternalId: string | null;
        navHref: string | null;
      }[];
    }[];
    expect(series.some((item) => item.markPoint)).toBe(false);
    const follower = series.find((item) => item.name === FOLLOWER_SAMPLE_SERIES_NAME);
    expect(follower?.connectNulls).toBe(true);
    const publish = series.find((item) => item.name === FOLLOWER_PUBLISH_SERIES_NAME);
    expect(publish?.type).toBe('scatter');
    expect(publish?.animation).toBe(false);
    expect(publish?.symbolSize).toBe(FOLLOWER_EVENT_SYMBOL_SIZE);
    expect(publish?.itemStyle?.color).toBe('transparent');
    expect(publish?.itemStyle?.borderColor).toBe(COLORS.series[2]);
    expect(publish?.itemStyle?.borderWidth).toBe(2);
    expect(publish?.data).toHaveLength(1);
    expect(publish?.data?.[0]?.value[0]).toBe(Date.parse('2026-10-23T03:00:00.000Z'));
    // Closest sample to earliest same-day event (03:00): 02:00 and 04:00 tie → first wins.
    expect(publish?.data?.[0]?.followerAtEvent).toBe(1000);
    expect(publish?.data?.[0]?.eventLabels).toEqual([
      `${formatShanghaiDateMinute('2026-10-23T03:00:00.000Z')} 发布了视频《聚合视频》`,
      `${formatShanghaiDateMinute('2026-10-23T05:00:00.000Z')} 发了动态《标题》`,
    ]);
    expect(publish?.data?.[0]?.navigableExternalId).toBe('BV1dd411c7mD');
    expect(publish?.data?.[0]?.navHref).toBe('/monitoring/videos/BV1dd411c7mD');
    expect(option.toolbox).toBeUndefined();
  });

  test('default mode hides events before the first sample; showAllEvents extends the axis', () => {
    const early = event({
      publishedAt: '2022-09-15T04:00:00.000Z',
      titleSnapshot: '很早的视频',
      externalId: 'BV1earlyxxxxxx',
    });
    const aug = event({
      publishedAt: '2026-08-28T05:29:00.000Z',
      eventKind: 'dynamic',
      titleSnapshot: '抽PS5和GTA6啦!',
      externalId: '1241488471951933462',
      navigable: false,
      monitoredTargetId: null,
    });

    const hidden = buildFollowerOptionDetailed(
      SAMPLES,
      FOLLOWERS,
      COLORS,
      0,
      100,
      [early, aug],
      NOW_MS,
      false,
    );
    expect(hidden.olderEventCount).toBe(2);
    expect(hidden.dayBuckets.size).toBe(0);
    expect(hidden.domain.minMs).toBe(Date.parse(SAMPLES[0]!));

    const shown = buildFollowerOptionDetailed(
      SAMPLES,
      FOLLOWERS,
      COLORS,
      0,
      100,
      [early, aug],
      NOW_MS,
      true,
    );
    expect(shown.olderEventCount).toBe(0);
    expect(shown.dayBuckets.size).toBe(2);
    expect(shown.domain.minMs).toBe(Date.parse('2022-09-15T04:00:00.000Z'));
    const series = shown.option.series as {
      name?: string;
      data?: { value: [number, number]; followerAtEvent: number | null }[];
      markArea?: { data?: unknown[] };
    }[];
    const publish = series.find((item) => item.name === FOLLOWER_PUBLISH_SERIES_NAME);
    expect(publish?.data).toHaveLength(2);
    for (const row of publish?.data ?? []) {
      expect(row.followerAtEvent).toBeNull();
    }
    const follower = series.find((item) => item.name === FOLLOWER_SAMPLE_SERIES_NAME);
    expect(follower?.markArea?.data?.length).toBeGreaterThan(0);
  });

  test('cross-month in-sample-range events plot at real dates with 无样本', () => {
    // Samples spanning Aug→Oct so Aug events fall inside the sample range.
    const samples = [
      '2026-08-01T02:00:00.000Z',
      '2026-10-23T02:00:00.000Z',
      '2026-10-23T04:00:00.000Z',
    ];
    const followers = [900, 1000, 1010];
    const { option, olderEventCount, dayBuckets } = buildFollowerOptionDetailed(
      samples,
      followers,
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
      false,
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
    }[];
    const publish = series.find((item) => item.name === FOLLOWER_PUBLISH_SERIES_NAME);
    expect(publish?.data).toHaveLength(2);
    const xs = (publish?.data ?? []).map((row) => row.value[0]).sort((a, b) => a - b);
    expect(xs[0]).toBe(Date.parse('2026-08-14T06:00:00.000Z'));
    expect(xs[1]).toBe(Date.parse('2026-08-28T05:29:00.000Z'));
    for (const row of publish?.data ?? []) {
      expect(row.followerAtEvent).toBeNull();
    }
    const aug28 = publish?.data?.find(
      (row) => row.value[0] === Date.parse('2026-08-28T05:29:00.000Z'),
    );
    expect(aug28?.eventLabels[0]).toContain('抽PS5和GTA6啦!');
  });

  test('y-axis bounds use the visible window, not the full history', () => {
    const samples: string[] = [];
    const followers: number[] = [];
    const start = Date.parse('2026-01-01T00:00:00.000Z');
    for (let i = 0; i < 120; i += 1) {
      samples.push(new Date(start + i * 86_400_000).toISOString());
      // Early history has a huge spike that must not flatten the recent window.
      followers.push(i < 5 ? 1_000_000 : 10_000 + i);
    }
    const full = buildFollowerOptionDetailed(
      samples,
      followers,
      COLORS,
      0,
      100,
      [],
      Date.parse('2026-05-01T00:00:00.000Z'),
    );
    const recent = buildFollowerOptionDetailed(
      samples,
      followers,
      COLORS,
      75,
      100,
      [],
      Date.parse('2026-05-01T00:00:00.000Z'),
    );
    const fullY = full.option.yAxis as { max?: number };
    const recentY = recent.option.yAxis as { max?: number };
    expect(fullY.max).toBeGreaterThan(500_000);
    expect(recentY.max).toBeLessThan(50_000);
  });

  test('large sample counts enable large/lttb mode and disable animation', () => {
    const samples: string[] = [];
    const followers: number[] = [];
    const start = Date.parse('2024-01-01T00:00:00.000Z');
    for (let i = 0; i < 600; i += 1) {
      samples.push(new Date(start + i * 86_400_000).toISOString());
      followers.push(1000 + i);
    }
    const option = buildFollowerOption(samples, followers, COLORS, samples, 0, 100, [], NOW_MS);
    const series = option.series as {
      name?: string;
      animation?: boolean;
      large?: boolean;
      sampling?: string;
    }[];
    const follower = series.find((item) => item.name === FOLLOWER_SAMPLE_SERIES_NAME);
    expect(follower?.animation).toBe(false);
    expect(follower?.large).toBe(true);
    expect(follower?.sampling).toBe('lttb');
    expect(option.animation).toBe(false);
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
          navigable: false,
          monitoredTargetId: null,
        },
      ],
      now,
      true,
    );
    type TipFormatter = (params: unknown) => string;
    const formatter = (option.option.tooltip as { formatter?: TipFormatter }).formatter;
    expect(typeof formatter).toBe('function');

    const eventMs = Date.parse('2026-08-28T05:29:00.000Z');
    const sampleMs = Date.parse('2026-10-23T01:00:00.000Z');
    const farText = formatter?.([
      {
        seriesName: FOLLOWER_SAMPLE_SERIES_NAME,
        marker: '',
        value: [sampleMs, 34698],
        axisValue: eventMs,
      },
    ]);
    expect(farText).toContain('该时段无采集样本');
    expect(farText).not.toContain('34,698');
    expect(farText).toContain('抽PS5和GTA6啦!');
    expect(farText).toContain('max-width:300px');
    expect(farText).toContain('data-follower-nav="/monitoring/dynamics/1145141919810"');
    expect(farText).toContain('-webkit-line-clamp:3');

    const nearText = formatter?.([
      {
        seriesName: FOLLOWER_SAMPLE_SERIES_NAME,
        marker: '',
        value: [sampleMs, 34698],
        axisValue: sampleMs,
      },
    ]);
    expect(nearText).toContain('34,698');
    expect(nearText).not.toContain('该时段无采集样本');
  });

  test('video tooltip includes cover and navigable href', () => {
    const option = buildFollowerOptionDetailed(
      SAMPLES,
      FOLLOWERS,
      COLORS,
      0,
      100,
      [
        event({
          publishedAt: '2026-10-23T03:00:00.000Z',
          titleSnapshot: 'A'.repeat(80),
          externalId: 'BV1coverxxxxxx',
          navigable: true,
          coverProxyUrl: '/api/v1/assets/abc',
        }),
      ],
      NOW_MS,
    );
    type TipFormatter = (params: unknown) => string;
    const formatter = (
      (option.option.series as { name?: string; tooltip?: { formatter?: TipFormatter } }[]).find(
        (s) => s.name === FOLLOWER_PUBLISH_SERIES_NAME,
      )?.tooltip as { formatter?: TipFormatter }
    ).formatter;
    expect(typeof formatter).toBe('function');
    const html = formatter?.({
      data: {
        eventItems: [
          {
            publishedAt: '2026-10-23T03:00:00.000Z',
            eventKind: 'video',
            titleSnapshot: 'A'.repeat(80),
            externalId: 'BV1coverxxxxxx',
            coverProxyUrl: '/api/v1/assets/abc',
            navHref: '/monitoring/videos/BV1coverxxxxxx',
            label: 'x',
          },
        ],
        followerAtEvent: 1000,
        navHref: '/monitoring/videos/BV1coverxxxxxx',
      },
    });
    expect(html).toContain('/api/v1/assets/abc');
    expect(html).toContain('data-follower-nav="/monitoring/videos/BV1coverxxxxxx"');
    expect(html).toContain('-webkit-line-clamp:3');
  });
});
