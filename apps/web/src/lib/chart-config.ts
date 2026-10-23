import type { EChartsOption, LineSeriesOption, ScatterSeriesOption } from 'echarts';
import { formatAxisLabels } from '@/lib/format-time';
import { formatCompactNumber, formatExactNumber } from '@/lib/format-compact-number';
import {
  formatViewCountThousandsFromRaw,
  formatViewCountThousandsUnit,
} from '@/lib/format-view-thousands';
import { defaultDataZoomRange } from '@/lib/chart-window';
import { followerYAxisBounds } from '@/lib/chart-follower-axis';
import type { ResolvedChartColors } from '@/lib/chart-colors';
import { chartSemanticFromResolved } from '@/lib/chart-colors';

const EMPHASIS = { focus: 'series' as const, blurScope: 'coordinateSystem' as const };

/** Independent scatter series for publish markers (not markPoint — avoids stuck scale/opacity=0). */
export const FOLLOWER_PUBLISH_SERIES_NAME = '发布';

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

export type FollowerChartPublishEvent = {
  publishedAt: string;
  eventKind: 'video' | 'dynamic';
  titleSnapshot: string;
  externalId: string;
  navigable: boolean;
  monitoredTargetId: string | null;
};

function nearestSampleIndex(sampledAtList: string[], publishedAt: string): number {
  const target = Date.parse(publishedAt);
  if (!Number.isFinite(target) || sampledAtList.length === 0) return 0;
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < sampledAtList.length; i += 1) {
    const t = Date.parse(sampledAtList[i]!);
    if (!Number.isFinite(t)) continue;
    const dist = Math.abs(t - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Aggregate overlapping publish markers onto sample buckets so dense points stay readable. */
export function aggregateFollowerEvents(
  sampledAtList: string[],
  events: FollowerChartPublishEvent[],
): Map<
  number,
  {
    labels: string[];
    navigableExternalId: string | null;
  }
> {
  const buckets = new Map<number, { labels: string[]; navigableExternalId: string | null }>();
  for (const event of events) {
    const idx = nearestSampleIndex(sampledAtList, event.publishedAt);
    const title = event.titleSnapshot?.trim() || event.externalId;
    const label = event.eventKind === 'video' ? `发布了视频《${title}》` : `发了动态《${title}》`;
    const existing = buckets.get(idx) ?? { labels: [], navigableExternalId: null };
    existing.labels.push(label);
    if (event.navigable && event.externalId && !existing.navigableExternalId) {
      existing.navigableExternalId = event.externalId;
    }
    buckets.set(idx, existing);
  }
  return buckets;
}

export function buildFollowerOption(
  sampledAtList: string[],
  followers: (number | null)[],
  colors: ResolvedChartColors,
  tooltipTimes: string[],
  visibleStartIndex = 0,
  visibleEndIndex = sampledAtList.length - 1,
  events: FollowerChartPublishEvent[] = [],
): EChartsOption {
  const base = buildTimeSeriesBase(sampledAtList, colors);
  const semantic = chartSemanticFromResolved(colors);
  const slice = followers.slice(
    Math.max(0, visibleStartIndex),
    Math.min(followers.length, visibleEndIndex + 1),
  );
  const bounds = followerYAxisBounds(slice, { nonNegative: true });
  const buckets = aggregateFollowerEvents(sampledAtList, events);
  const publishPoints = [...buckets.entries()].map(([idx, bucket]) => {
    const fans = followers[idx] ?? 0;
    return {
      name:
        bucket.labels.length > 1 ? `${bucket.labels.length} 条发布` : (bucket.labels[0] ?? '发布'),
      value: [idx, fans] as [number, number],
      eventLabels: bucket.labels,
      navigableExternalId: bucket.navigableExternalId,
    };
  });

  const followerSeries = lineSeries('粉丝数', followers, semantic.series1);
  // Scatter (not markPoint): markPoint init animation was stuck at opacity=0 / scaleX=0 in zrender.
  const publishSeries: ScatterSeriesOption | null =
    publishPoints.length === 0
      ? null
      : {
          name: FOLLOWER_PUBLISH_SERIES_NAME,
          type: 'scatter',
          data: publishPoints,
          symbol: 'diamond',
          symbolSize: 16,
          animation: false,
          z: 10,
          zlevel: 1,
          clip: true,
          cursor: 'pointer',
          itemStyle: { color: semantic.series2, opacity: 1 },
          emphasis: {
            focus: 'self',
            scale: false,
            itemStyle: { color: semantic.series2, opacity: 1, borderWidth: 1 },
          },
          // Survive line-series blurScope so markers stay opaque while axis-hovering.
          blur: { itemStyle: { opacity: 1 } },
          tooltip: {
            formatter: (params: unknown) => {
              const row = params as {
                data?: { eventLabels?: string[]; value?: [number, number] | number };
                name?: string;
              };
              const labels = row.data?.eventLabels ?? [row.name ?? '发布'];
              const raw = row.data?.value;
              const fans = Array.isArray(raw) ? raw[1] : raw;
              return [...labels, `当时粉丝量：${formatExactNumber(fans ?? null)}`].join('<br/>');
            },
          },
        };

  return {
    ...base,
    legend: {
      ...base.legend,
      // Keep the follower legend primary; publish markers are decorative overlays.
      data: publishSeries ? ['粉丝数', FOLLOWER_PUBLISH_SERIES_NAME] : ['粉丝数'],
    },
    tooltip: {
      ...base.tooltip,
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        const primary = items.find((item) => item.seriesName === '粉丝数') ?? items[0];
        const idx = primary?.dataIndex ?? 0;
        const time = tooltipTimes[idx] ?? '';
        const val = followers[idx];
        const bucket = buckets.get(idx);
        const eventLines = bucket?.labels ?? [];
        const marker = primary?.marker ?? '';
        return [time, `${marker}粉丝数：${formatExactNumber(val)}`, ...eventLines].join('<br/>');
      },
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
