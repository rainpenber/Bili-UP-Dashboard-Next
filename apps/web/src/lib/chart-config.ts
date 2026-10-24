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
  partitionEventsBySampleRange,
  shanghaiCalendarDayKey,
  type FollowerChartPublishEvent,
  type FollowerEventDayBucket,
  type FollowerEventTooltipItem,
} from '@/lib/chart-follower-events';

export type { FollowerChartPublishEvent } from '@/lib/chart-follower-events';
export {
  aggregateFollowerEventsByDay,
  FOLLOWER_EVENT_WINDOW_DAYS,
  FOLLOWER_VIEW_WINDOW_DAYS,
  partitionEventsBySampleRange,
  partitionEventsByWindow,
  shanghaiCalendarDayKey,
} from '@/lib/chart-follower-events';

const EMPHASIS = { focus: 'series' as const, blurScope: 'coordinateSystem' as const };

/** Follower line — samples only; gaps are not fabricated zeros. */
export const FOLLOWER_SAMPLE_SERIES_NAME = '粉丝数';

/** Independent scatter series for publish markers (not markPoint — avoids stuck scale/opacity=0). */
export const FOLLOWER_PUBLISH_SERIES_NAME = '事件';

/** Hollow event marker size (idle / hover). */
export const FOLLOWER_EVENT_SYMBOL_SIZE = 11;
export const FOLLOWER_EVENT_SYMBOL_HOVER_SIZE = 14;

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
  domain: { minMs: number; maxMs: number };
};

function formatFollowerAtEvent(fans: number | null): string {
  if (fans == null) return '无样本';
  return formatExactNumber(fans);
}

function markerYForEvent(fans: number | null, fallbackY: number): number {
  return fans ?? fallbackY;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dynamicIconSvg(foreground: string): string {
  const fill = encodeURIComponent(foreground);
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40" viewBox="0 0 64 40"><rect width="64" height="40" rx="4" fill="${fill}" opacity="0.12"/><path d="M18 12h28v3H18zm0 7h22v3H18zm0 7h16v3H18z" fill="${fill}" opacity="0.55"/></svg>`,
  )}`;
}

function eventThumbHtml(item: FollowerEventTooltipItem, colors: ResolvedChartColors): string {
  const src =
    item.eventKind === 'video' && item.coverProxyUrl
      ? item.coverProxyUrl
      : dynamicIconSvg(colors.mutedForeground);
  return `<img src="${escapeHtml(src)}" alt="" width="64" height="40" style="width:64px;height:40px;border-radius:4px;object-fit:cover;flex-shrink:0;background:${escapeHtml(colors.border)}" />`;
}

function eventTitleBlockHtml(item: FollowerEventTooltipItem, colors: ResolvedChartColors): string {
  const title = escapeHtml(item.titleSnapshot || item.externalId);
  const kind = item.eventKind === 'video' ? '视频' : '动态';
  return `<div style="min-width:0;flex:1">
    <div style="font-size:11px;color:${escapeHtml(colors.mutedForeground)};margin-bottom:2px">${kind}</div>
    <div style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;word-break:break-word;line-height:1.35;max-height:4.05em">${title}</div>
  </div>`;
}

function renderFollowerEventTooltipHtml(args: {
  items: FollowerEventTooltipItem[];
  fans: number | null;
  colors: ResolvedChartColors;
  timeLine?: string;
  sampleLine?: string;
  navHref: string | null;
}): string {
  const { items, fans, colors, timeLine, sampleLine, navHref } = args;
  const rows = items
    .map(
      (item) =>
        `<div style="display:flex;gap:8px;align-items:flex-start;margin-top:8px">${eventThumbHtml(item, colors)}${eventTitleBlockHtml(item, colors)}</div>`,
    )
    .join('');
  const body = [
    timeLine ? `<div style="margin-bottom:4px">${escapeHtml(timeLine)}</div>` : '',
    sampleLine ? `<div>${sampleLine}</div>` : '',
    rows,
    `<div style="margin-top:8px;color:${escapeHtml(colors.mutedForeground)}">当时粉丝量：${escapeHtml(formatFollowerAtEvent(fans))}</div>`,
  ].join('');
  const clickable = Boolean(navHref);
  const cursor = clickable ? 'pointer' : 'default';
  const navAttr = navHref ? ` data-follower-nav="${escapeHtml(navHref)}"` : '';
  return `<div class="follower-chart-tooltip"${navAttr} style="max-width:300px;cursor:${cursor};color:${escapeHtml(colors.foreground)}">${body}</div>`;
}

export type BuildFollowerOptionArgs = {
  sampledAtList: string[];
  followers: (number | null)[];
  colors: ResolvedChartColors;
  visibleStartPercent?: number;
  visibleEndPercent?: number;
  events?: FollowerChartPublishEvent[];
  nowMs?: number;
  /** When true, plot events before the first sample and extend the x domain. */
  showAllEvents?: boolean;
};

/**
 * Follower chart on a time axis: samples only where collected; publish markers at real
 * publishedAt (Asia/Shanghai same-day aggregation). Default view = last 90 days of samples;
 * 「显示全部事件」 extends the domain to earlier publish dates.
 */
export const FOLLOWER_RENDER_POINT_LIMIT = 400;

/** Keep the full source range but cap canvas work, preserving bucket extrema. */
export function downsampleFollowerPairs(
  pairs: [number, number][],
  limit = FOLLOWER_RENDER_POINT_LIMIT,
): [number, number][] {
  if (pairs.length <= limit || limit < 4) return pairs;
  const interior = pairs.slice(1, -1);
  const bucketCount = Math.max(1, Math.floor((limit - 2) / 2));
  const bucketSize = Math.ceil(interior.length / bucketCount);
  const sampled: [number, number][] = [pairs[0]!];
  for (let start = 0; start < interior.length; start += bucketSize) {
    const bucket = interior.slice(start, start + bucketSize);
    let min = bucket[0]!;
    let max = bucket[0]!;
    for (const point of bucket.slice(1)) {
      if (point[1] < min[1]) min = point;
      if (point[1] > max[1]) max = point;
    }
    if (min[0] <= max[0]) {
      sampled.push(min);
      if (max !== min) sampled.push(max);
    } else {
      sampled.push(max);
      if (max !== min) sampled.push(min);
    }
  }
  sampled.push(pairs[pairs.length - 1]!);
  return sampled.slice(0, limit);
}

export function buildFollowerOption(
  sampledAtList: string[],
  followers: (number | null)[],
  colors: ResolvedChartColors,
  _tooltipTimes: string[],
  visibleStartPercent = 0,
  visibleEndPercent = 100,
  events: FollowerChartPublishEvent[] = [],
  nowMs: number = Date.now(),
  showAllEvents = false,
): EChartsOption {
  return buildFollowerOptionDetailed(
    sampledAtList,
    followers,
    colors,
    visibleStartPercent,
    visibleEndPercent,
    events,
    nowMs,
    showAllEvents,
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
  showAllEvents = false,
): BuildFollowerOptionResult {
  const semantic = chartSemanticFromResolved(colors);
  /** Amber / gold — contrast against blue/green follower lines across accents. */
  const eventColor = semantic.series3;

  const samplePairs: [number, number][] = [];
  for (let i = 0; i < sampledAtList.length; i += 1) {
    const t = Date.parse(sampledAtList[i]!);
    const v = followers[i];
    if (!Number.isFinite(t) || v == null) continue;
    samplePairs.push([t, v]);
  }
  const sampleTimesMs = samplePairs.map(([t]) => t);

  const { inRange, outsideCount } = partitionEventsBySampleRange(events, sampleTimesMs);
  const plottedEvents = showAllEvents ? events : inRange;
  const dayBuckets = aggregateFollowerEventsByDay(plottedEvents);
  const eventTimesMs = [...dayBuckets.values()].map((b) => b.xMs);
  const domain = buildFollowerTimeDomain({
    sampleTimesMs,
    eventTimesMs,
    nowMs,
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

  const samplesByDay = new Map<string, { timeMs: number; followers: number }[]>();
  for (let i = 0; i < sampledAtList.length; i += 1) {
    const followersAtSample = followers[i];
    if (followersAtSample == null) continue;
    const dayKey = shanghaiCalendarDayKey(sampledAtList[i]!);
    const timeMs = Date.parse(sampledAtList[i]!);
    if (!dayKey || !Number.isFinite(timeMs)) continue;
    const rows = samplesByDay.get(dayKey) ?? [];
    rows.push({ timeMs, followers: followersAtSample });
    samplesByDay.set(dayKey, rows);
  }

  const followerFromIndexedDay = (dayKey: string, aroundMs: number): number | null => {
    let fans: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const sample of samplesByDay.get(dayKey) ?? []) {
      const distance = Math.abs(sample.timeMs - aroundMs);
      if (distance < bestDistance) {
        bestDistance = distance;
        fans = sample.followers;
      }
    }
    return fans;
  };

  const publishPoints = [...dayBuckets.values()].map((bucket) => {
    const fans = followerFromIndexedDay(bucket.dayKey, bucket.xMs);
    return {
      name:
        bucket.labels.length > 1 ? `${bucket.labels.length} 条发布` : (bucket.labels[0] ?? '发布'),
      value: [bucket.xMs, markerYForEvent(fans, fallbackMarkerY)] as [number, number],
      eventLabels: bucket.labels,
      eventItems: bucket.items,
      followerAtEvent: fans,
      navigableExternalId: bucket.navigableExternalId,
      navHref: bucket.navHref,
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

  const renderPairs = downsampleFollowerPairs(samplePairs);

  const followerSeries: LineSeriesOption = {
    name: FOLLOWER_SAMPLE_SERIES_NAME,
    type: 'line',
    data: renderPairs,
    connectNulls: true,
    showSymbol: false,
    animation: false,
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
          symbolSize: FOLLOWER_EVENT_SYMBOL_SIZE,
          animation: false,
          large: publishPoints.length >= 200,
          largeThreshold: 200,
          z: 10,
          zlevel: 1,
          clip: true,
          cursor: 'pointer',
          itemStyle: {
            color: 'transparent',
            opacity: 1,
            borderColor: eventColor,
            borderWidth: 2,
          },
          emphasis: {
            focus: 'self',
            scale: FOLLOWER_EVENT_SYMBOL_HOVER_SIZE / FOLLOWER_EVENT_SYMBOL_SIZE,
            itemStyle: {
              color: 'transparent',
              opacity: 1,
              borderColor: eventColor,
              borderWidth: 2,
            },
          },
          blur: { itemStyle: { opacity: 1 } },
          tooltip: {
            formatter: (params: unknown) => {
              const row = params as {
                data?: {
                  eventItems?: FollowerEventTooltipItem[];
                  eventLabels?: string[];
                  followerAtEvent?: number | null;
                  navHref?: string | null;
                  name?: string;
                };
                name?: string;
              };
              const items = row.data?.eventItems ?? [];
              const fans = row.data?.followerAtEvent ?? null;
              if (items.length === 0) {
                const labels = row.data?.eventLabels ?? [row.name ?? row.data?.name ?? '发布'];
                return [...labels, `当时粉丝量：${formatFollowerAtEvent(fans)}`].join('<br/>');
              }
              return renderFollowerEventTooltipHtml({
                items,
                fans,
                colors,
                navHref: row.data?.navHref ?? null,
              });
            },
          },
        };

  const bucketsByDay = dayBuckets;
  const option: EChartsOption = {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      enterable: true,
      confine: true,
      extraCssText: 'max-width:300px;white-space:normal;',
      axisPointer: { type: 'line', lineStyle: { color: semantic.series1, opacity: 0.35 } },
      backgroundColor: colors.background,
      borderColor: colors.border,
      textStyle: { color: colors.foreground, fontSize: 12 },
      formatter: (params) => {
        const tipItems = Array.isArray(params) ? params : [params];
        const scatterHit = tipItems.find(
          (item) => item.seriesName === FOLLOWER_PUBLISH_SERIES_NAME,
        ) as
          | {
              data?: {
                eventItems?: FollowerEventTooltipItem[];
                followerAtEvent?: number | null;
                navHref?: string | null;
              };
            }
          | undefined;
        const primary =
          tipItems.find((item) => item.seriesName === FOLLOWER_SAMPLE_SERIES_NAME) ?? tipItems[0];
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
        const axisRaw = (tipItems[0] as { axisValue?: unknown } | undefined)?.axisValue;
        const axisMs =
          typeof axisRaw === 'number'
            ? axisRaw
            : axisRaw != null
              ? Date.parse(String(axisRaw))
              : Number.NaN;
        const sampleMs = timeMs;
        const sampleIsNear =
          sampleMs != null &&
          Number.isFinite(sampleMs) &&
          Number.isFinite(axisMs) &&
          Math.abs(sampleMs - axisMs) <= 3 * 60 * 60 * 1000;
        const hoverMs = Number.isFinite(axisMs) ? axisMs : sampleMs;
        const hoverTime =
          hoverMs != null && Number.isFinite(hoverMs)
            ? formatFullLocalTime(new Date(hoverMs).toISOString())
            : time;
        const effectiveDayKey =
          hoverMs != null && Number.isFinite(hoverMs)
            ? shanghaiCalendarDayKey(new Date(hoverMs).toISOString())
            : dayKey;
        const bucket = effectiveDayKey ? bucketsByDay.get(effectiveDayKey) : undefined;
        const eventItems =
          scatterHit?.data?.eventItems ?? bucket?.items ?? ([] as FollowerEventTooltipItem[]);
        const eventFans =
          scatterHit?.data?.followerAtEvent !== undefined
            ? scatterHit.data.followerAtEvent
            : sampleIsNear
              ? fans
              : bucket
                ? followerFromIndexedDay(bucket.dayKey, bucket.xMs)
                : null;
        const marker = primary?.marker ?? '';
        const sampleLine = sampleIsNear
          ? `${marker}${FOLLOWER_SAMPLE_SERIES_NAME}：${formatExactNumber(fans)}`
          : `${FOLLOWER_SAMPLE_SERIES_NAME}：该时段无采集样本`;
        if (eventItems.length > 0) {
          return renderFollowerEventTooltipHtml({
            items: eventItems,
            fans: eventFans ?? null,
            colors,
            timeLine: hoverTime,
            sampleLine,
            navHref: scatterHit?.data?.navHref ?? bucket?.navHref ?? null,
          });
        }
        return [hoverTime, sampleLine].join('<br/>');
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
    grid: { left: 52, right: 52, top: 44, bottom: 72 },
    dataZoom: [
      {
        type: 'inside',
        start: visibleStartPercent,
        end: visibleEndPercent,
        zoomOnMouseWheel: true,
      },
      {
        type: 'slider',
        height: 22,
        bottom: 8,
        start: visibleStartPercent,
        end: visibleEndPercent,
        borderColor: colors.border,
        fillerColor: 'rgba(128,128,128,0.15)',
        handleStyle: { color: colors.mutedForeground },
        textStyle: { color: colors.mutedForeground },
      },
    ],
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

  return {
    option,
    olderEventCount: showAllEvents ? 0 : outsideCount,
    dayBuckets,
    domain,
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
