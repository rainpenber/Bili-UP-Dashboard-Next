import type { EChartsOption, LineSeriesOption } from 'echarts';
import { formatAxisLabels } from '@/lib/format-time';
import { formatCompactNumber, formatExactNumber } from '@/lib/format-compact-number';
import { defaultDataZoomRange } from '@/lib/chart-window';
import { followerYAxisBounds } from '@/lib/chart-follower-axis';
import type { ResolvedChartColors } from '@/lib/chart-colors';
import { chartSemanticFromResolved } from '@/lib/chart-colors';

const EMPHASIS = { focus: 'series' as const, blurScope: 'coordinateSystem' as const };

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
            return `${p.marker}${name}：${formatExactNumber(raw)}（${formatCompactNumber(viewsK[idx] ?? null)} 千次）`;
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
          formatter: (v: number) => formatCompactNumber(v),
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

export function buildFollowerOption(
  sampledAtList: string[],
  followers: (number | null)[],
  colors: ResolvedChartColors,
  tooltipTimes: string[],
  visibleStartIndex = 0,
  visibleEndIndex = sampledAtList.length - 1,
): EChartsOption {
  const base = buildTimeSeriesBase(sampledAtList, colors);
  const semantic = chartSemanticFromResolved(colors);
  const slice = followers.slice(
    Math.max(0, visibleStartIndex),
    Math.min(followers.length, visibleEndIndex + 1),
  );
  const bounds = followerYAxisBounds(slice, { nonNegative: true });

  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        const idx = items[0]?.dataIndex ?? 0;
        const time = tooltipTimes[idx] ?? '';
        const val = followers[idx];
        return `${time}<br/>${items[0]?.marker}粉丝数：${formatExactNumber(val)}`;
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
    series: [lineSeries('粉丝数', followers, semantic.series1)],
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
