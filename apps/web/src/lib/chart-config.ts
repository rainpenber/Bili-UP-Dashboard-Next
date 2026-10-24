import type { EChartsOption, LineSeriesOption, ScatterSeriesOption } from 'echarts';
import { formatAxisLabels, formatFullLocalTime } from '@/lib/format-time';
import { formatCompactNumber, formatExactNumber } from '@/lib/format-compact-number';
import {
  formatViewCountThousandsFromRaw,
  formatViewCountThousandsUnit,
} from '@/lib/format-view-thousands';
import { defaultDataZoomRange } from '@/lib/chart-window';
import { followerYAxisBounds } from '@/lib/chart-follower-axis';
import type { ResolvedChartColors } from '@/lib/chart-colors';
import { chartSemanticFromResolved } from '@/lib/chart-colors';
import {
  aggregateFollowerEventsByDay,
  buildFollowerTimeDomain,
  followerSampleOnDay,
  partitionEventsByWindow,
  shanghaiCalendarDayKey,
  type FollowerChartPublishEvent,
  type FollowerEventDayBucket,
} from '@/lib/chart-follower-events';

export type { FollowerChartPublishEvent } from '@/lib/chart-follower-events';
export {
  aggregateFollowerEventsByDay,
  FOLLOWER_EVENT_WINDOW_DAYS,
  partitionEventsByWindow,
  shanghaiCalendarDayKey,
} from '@/lib/chart-follower-events';

const EMPHASIS = { focus: 'series' as const, blurScope: 'coordinateSystem' as const };

/** Follower line — samples only; gaps are not fabricated zeros. */
export const FOLLOWER_SAMPLE_SERIES_NAME = '粉丝数（样本）';

/** Independent scatter series for publish markers (not markPoint — avoids stuck scale/opacity=0). */
export const FOLLOWER_PUBLISH_SERIES_NAME = '发布（事件日期）';

function lineSeries(
  name: string,
  data: (number | string | null)[],
  color: string,
  yAxisIndex = 0,
): LineSeriesOption {
  return {
    name,
    type: 'line',
    yAxisIndex,
    data,
    connectNulls: false,
    showSymbol: false,
    lineStyle: { width: 2, color },
    itemStyle: { color },
    emphasis: {
      ...EMPHASIS,
      lineStyle: { width: 3, color },
      itemStyle: { color, borderColor: color },
    },
    blur: {
      lineStyle: { opacity: 0.15 },
      itemStyle: { opacity: 0.15 },
    },
  };
}

export function buildTimeSeriesBase(
  sampledAtList: string[],
  colors: ResolvedChartColors,
): Pick<
  EChartsOption,
  'tooltip' | 'legend' | 'dataZoom' | 'toolbox' | 'xAxis' | 'grid' | 'backgroundColor'
> {
  const zoom = defaultDataZoomRange(sampledAtList);
  const labels = formatAxisLabels(sampledAtList);
  const semantic = chartSemanticFromResolved(colors);

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: semantic.series1, opacity: 0.35 } },
      backgroundColor: colors.background,
      borderColor: colors.border,
      textStyle: { color: colors.foreground, fontSize: 12 },
    },
    legend: {
      top: 0,
      type: 'scroll',
      textStyle: { color: colors.foreground },
      inactiveColor: colors.mutedForeground,
    },
    grid: { left: 52, right: 52, top: 44, bottom: 52 },
    dataZoom: [
      { type: 'inside', start: zoom.start, end: zoom.end },
      { type: 'slider', height: 20, start: zoom.start, end: zoom.end },
    ],
    toolbox: {
      feature: { restore: {} },
      iconStyle: { borderColor: colors.mutedForeground },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: colors.mutedForeground, hideOverlap: true },
      axisLine: { lineStyle: { color: colors.border } },
    },
  };
}

export function buildVideoViewsOption(
  sampledAtList: string[],
  online: (number | string | null)[],
  views: (number | null)[],
  colors: ResolvedChartColors,
  tooltipTimes: string[],
): EChartsOption {
  const base = buildTimeSeriesBase(sampledAtList, colors);
  const semantic = chartSemanticFromResolved(colors);
  const viewsK = views.map((v) => (v != null ? v / 1000 : null));

  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        const idx = items[0]?.dataIndex ?? 0;
        const time = tooltipTimes[idx] ?? '';
        const lines = items.map((p) => {
          const name = p.seriesName ?? '';
          if (name === '播放量') {
            const raw = views[idx];
            return `${p.marker}${name}：${formatExactNumber(raw)}（${formatViewCountThousandsFromRaw(raw ?? null)} 千次）`;
          }
          return `${p.marker}${name}：${formatExactNumber(p.data as number | string | null)}`;
        });
        return [time, ...lines].join('<br/>');
      },
    },
    yAxis: [
      {
        type: 'value',
        name: '在线',
        position: 'left',
        axisLabel: {
          color: colors.mutedForeground,
          formatter: (v: number) => formatCompactNumber(v),
        },
        splitLine: { lineStyle: { color: colors.border, opacity: 0.5 } },
      },
      {
        type: 'value',
        name: '播放(千次)',
        position: 'right',
        axisLabel: {
          color: colors.mutedForeground,
          formatter: (v: number) => formatViewCountThousandsUnit(v),
        },
        splitLine: { show: false },
      },
    ],
    series: [
      lineSeries('在线观看', online, semantic.series1, 0),
      lineSeries('播放量', viewsK, semantic.series2, 1),
    ],
  };
}

export function buildVideoEngagementOption(
  sampledAtList: string[],
  series: { name: string; data: (number | null)[]; color: string }[],
  colors: ResolvedChartColors,
  tooltipTimes: string[],
): EChartsOption {
  const base = buildTimeSeriesBase(sampledAtList, colors);
  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        const idx = items[0]?.dataIndex ?? 0;
        const time = tooltipTimes[idx] ?? '';
        const lines = items.map(
          (p) => `${p.marker}${p.seriesName}：${formatExactNumber(p.data as number | null)}`,
        );
        return [time, ...lines].join('<br/>');
      },
    },
    yAxis: {
      type: 'value',
      name: '互动',
      axisLabel: {
        color: colors.mutedForeground,
        formatter: (v: number) => formatCompactNumber(v),
      },
      splitLine: { lineStyle: { color: colors.border, opacity: 0.5 } },
    },
    series: series.map((s) => lineSeries(s.name, s.data, s.color)),
  };
}

/** @deprecated Prefer aggregateFollowerEventsByDay — kept name for call-site migration. */
export function aggregateFollowerEvents(
  _sampledAtList: string[],
  events: FollowerChartPublishEvent[],
): Map<string, FollowerEventDayBucket> {
  return aggregateFollowerEventsByDay(events);
}

export type BuildFollowerOptionResult = {
  option: EChartsOption;
  olderEventCount: number;
  dayBuckets: Map<string, FollowerEventDayBucket>;
};

function formatFollowerAtEvent(fans: number | null): string {
  if (fans == null) return '无样本';
  return formatExactNumber(fans);
}

function markerYForEvent(fans: number | null, fallbackY: number): number {
  return fans ?? fallbackY;
}

/**
 * Follower chart on a time axis: samples only where collected; publish markers at real
 * publishedAt (Asia/Shanghai same-day aggregation). Default event window = 90 days.
 */
export function buildFollowerOption(
  sampledAtList: string[],
  followers: (number | null)[],
  colors: ResolvedChartColors,
  _tooltipTimes: string[],
  visibleStartPercent = 0,
  visibleEndPercent = 100,
  events: FollowerChartPublishEvent[] = [],
  nowMs: number = Date.now(),
): EChartsOption {
  return buildFollowerOptionDetailed(
    sampledAtList,
    followers,
    colors,
    visibleStartPercent,
    visibleEndPercent,
    events,
    nowMs,
  ).option;
}

export function buildFollowerOptionDetailed(
  sampledAtList: string[],
  followers: (number | null)[],
  colors: ResolvedChartColors,
  visibleStartPercent = 0,
  visibleEndPercent = 100,
  events: FollowerChartPublishEvent[] = [],
  nowMs: number = Date.now(),
): BuildFollowerOptionResult {
  const semantic = chartSemanticFromResolved(colors);
  const { inWindow, olderCount, windowStartMs } = partitionEventsByWindow(events, nowMs);
  const dayBuckets = aggregateFollowerEventsByDay(inWindow);

  const samplePairs: [number, number][] = [];
  for (let i = 0; i < sampledAtList.length; i += 1) {
    const t = Date.parse(sampledAtList[i]!);
    const v = followers[i];
    if (!Number.isFinite(t) || v == null) continue;
    samplePairs.push([t, v]);
  }
  const sampleTimesMs = samplePairs.map(([t]) => t);
  const eventTimesMs = [...dayBuckets.values()].map((b) => b.xMs);
  const domain = buildFollowerTimeDomain({
    sampleTimesMs,
    eventTimesMs,
    nowMs,
    windowStartMs,
  });

  const span = Math.max(1, domain.maxMs - domain.minMs);
  const viewStartMs = domain.minMs + (span * Math.min(100, Math.max(0, visibleStartPercent))) / 100;
  const viewEndMs = domain.minMs + (span * Math.min(100, Math.max(0, visibleEndPercent))) / 100;
  const visibleFollowers = samplePairs
    .filter(([t]) => t >= viewStartMs && t <= viewEndMs)
    .map(([, v]) => v);
  const bounds = followerYAxisBounds(
    visibleFollowers.length > 0 ? visibleFollowers : samplePairs.map(([, v]) => v),
    { nonNegative: true },
  );
  const fallbackMarkerY = bounds
    ? (bounds.min + bounds.max) / 2
    : (samplePairs[samplePairs.length - 1]?.[1] ?? 0);

  const publishPoints = [...dayBuckets.values()].map((bucket) => {
    const fans = followerSampleOnDay(bucket.dayKey, sampledAtList, followers, bucket.xMs);
    return {
      name:
        bucket.labels.length > 1 ? `${bucket.labels.length} 条发布` : (bucket.labels[0] ?? '发布'),
      value: [bucket.xMs, markerYForEvent(fans, fallbackMarkerY)] as [number, number],
      eventLabels: bucket.labels,
      followerAtEvent: fans,
      navigableExternalId: bucket.navigableExternalId,
      dayKey: bucket.dayKey,
    };
  });

  const noSampleMarkAreas: [{ xAxis: number }, { xAxis: number }][] = [];
  if (sampleTimesMs.length === 0) {
    noSampleMarkAreas.push([{ xAxis: domain.minMs }, { xAxis: domain.maxMs }]);
  } else {
    const firstSample = Math.min(...sampleTimesMs);
    const lastSample = Math.max(...sampleTimesMs);
    if (firstSample > domain.minMs) {
      noSampleMarkAreas.push([{ xAxis: domain.minMs }, { xAxis: firstSample }]);
    }
    if (lastSample < domain.maxMs) {
      noSampleMarkAreas.push([{ xAxis: lastSample }, { xAxis: domain.maxMs }]);
    }
  }

  const followerSeries: LineSeriesOption = {
    name: FOLLOWER_SAMPLE_SERIES_NAME,
    type: 'line',
    data: samplePairs,
    connectNulls: true,
    showSymbol: false,
    lineStyle: { width: 2, color: semantic.series1 },
    itemStyle: { color: semantic.series1 },
    emphasis: {
      ...EMPHASIS,
      lineStyle: { width: 3, color: semantic.series1 },
      itemStyle: { color: semantic.series1, borderColor: semantic.series1 },
    },
    blur: {
      lineStyle: { opacity: 0.15 },
      itemStyle: { opacity: 0.15 },
    },
    ...(noSampleMarkAreas.length > 0
      ? {
          markArea: {
            silent: true,
            itemStyle: {
              color: colors.mutedForeground,
              opacity: 0.08,
            },
            data: noSampleMarkAreas,
            label: {
              show: noSampleMarkAreas.length > 0,
              position: 'insideTop',
              formatter: '该时段无采集样本',
              color: colors.mutedForeground,
              fontSize: 11,
            },
          },
        }
      : {}),
  };

  const publishSeries: ScatterSeriesOption | null =
    publishPoints.length === 0
      ? null
      : {
          name: FOLLOWER_PUBLISH_SERIES_NAME,
          type: 'scatter',
          data: publishPoints,
          symbol: 'circle',
          symbolSize: 12,
          animation: false,
          z: 10,
          zlevel: 1,
          clip: true,
          cursor: 'pointer',
          itemStyle: {
            color: semantic.series2,
            opacity: 1,
            borderColor: colors.background,
            borderWidth: 2,
          },
          emphasis: {
            focus: 'self',
            scale: false,
            itemStyle: { color: semantic.series2, opacity: 1, borderWidth: 1 },
          },
          blur: { itemStyle: { opacity: 1 } },
          tooltip: {
            formatter: (params: unknown) => {
              const row = params as {
                data?: {
                  eventLabels?: string[];
                  followerAtEvent?: number | null;
                  name?: string;
                };
                name?: string;
              };
              const labels = row.data?.eventLabels ?? [row.name ?? row.data?.name ?? '发布'];
              const fans = row.data?.followerAtEvent ?? null;
              return [...labels, `当时粉丝量：${formatFollowerAtEvent(fans)}`].join('<br/>');
            },
          },
        };

  const bucketsByDay = dayBuckets;
  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: semantic.series1, opacity: 0.35 } },
      backgroundColor: colors.background,
      borderColor: colors.border,
      textStyle: { color: colors.foreground, fontSize: 12 },
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        const primary =
          items.find((item) => item.seriesName === FOLLOWER_SAMPLE_SERIES_NAME) ?? items[0];
        const raw = primary?.value;
        let timeMs: number | null = null;
        let fans: number | null = null;
        if (Array.isArray(raw)) {
          timeMs = typeof raw[0] === 'number' ? raw[0] : Date.parse(String(raw[0]));
          fans = typeof raw[1] === 'number' ? raw[1] : null;
        }
        const time =
          timeMs != null && Number.isFinite(timeMs)
            ? formatFullLocalTime(new Date(timeMs).toISOString())
            : '';
        const dayKey =
          timeMs != null && Number.isFinite(timeMs)
            ? shanghaiCalendarDayKey(new Date(timeMs).toISOString())
            : null;
        const eventLines = dayKey ? (bucketsByDay.get(dayKey)?.labels ?? []) : [];
        const marker = primary?.marker ?? '';
        return [
          time,
          `${marker}${FOLLOWER_SAMPLE_SERIES_NAME}：${formatExactNumber(fans)}`,
          ...eventLines,
        ].join('<br/>');
      },
    },
    legend: {
      top: 0,
      type: 'scroll',
      textStyle: { color: colors.foreground },
      inactiveColor: colors.mutedForeground,
      data: publishSeries
        ? [FOLLOWER_SAMPLE_SERIES_NAME, FOLLOWER_PUBLISH_SERIES_NAME]
        : [FOLLOWER_SAMPLE_SERIES_NAME],
    },
    grid: { left: 52, right: 52, top: 44, bottom: 52 },
    dataZoom: [
      { type: 'inside', start: visibleStartPercent, end: visibleEndPercent },
      { type: 'slider', height: 20, start: visibleStartPercent, end: visibleEndPercent },
    ],
    toolbox: {
      feature: { restore: {} },
      iconStyle: { borderColor: colors.mutedForeground },
    },
    xAxis: {
      type: 'time',
      min: domain.minMs,
      max: domain.maxMs,
      axisLabel: {
        color: colors.mutedForeground,
        hideOverlap: true,
        formatter: (value: number) => {
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Shanghai',
            month: 'numeric',
            day: 'numeric',
          }).formatToParts(new Date(value));
          const month = parts.find((p) => p.type === 'month')?.value ?? '';
          const day = parts.find((p) => p.type === 'day')?.value ?? '';
          return `${month}/${day}`;
        },
      },
      axisLine: { lineStyle: { color: colors.border } },
    },
    yAxis: {
      type: 'value',
      ...(bounds ? { min: bounds.min, max: bounds.max } : {}),
      axisLabel: {
        color: colors.mutedForeground,
        formatter: (v: number) => formatCompactNumber(v),
      },
      splitLine: { lineStyle: { color: colors.border, opacity: 0.5 } },
    },
    series: publishSeries ? [followerSeries, publishSeries] : [followerSeries],
  };

  return { option, olderEventCount: olderCount, dayBuckets };
}

export function buildDynamicOption(
  sampledAtList: string[],
  series: { name: string; data: (number | null)[]; color: string }[],
  colors: ResolvedChartColors,
  tooltipTimes: string[],
): EChartsOption {
  return buildVideoEngagementOption(sampledAtList, series, colors, tooltipTimes);
}

export function visibleIndexRange(
  length: number,
  startPercent: number,
  endPercent: number,
): { start: number; end: number } {
  if (length <= 0) return { start: 0, end: 0 };
  const start = Math.floor((startPercent / 100) * length);
  const end = Math.min(length - 1, Math.ceil((endPercent / 100) * length) - 1);
  return { start: Math.max(0, start), end: Math.max(0, end) };
}
