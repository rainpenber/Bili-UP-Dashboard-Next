import type { EChartsOption } from 'echarts';

export const chartSemanticColors = {
  series1: 'var(--chart-1)',
  series2: 'var(--chart-2)',
  series3: 'var(--chart-3)',
  series4: 'var(--chart-4)',
  series5: 'var(--chart-5)',
};

export function baseTimeSeriesOption(
  times: string[],
): Pick<EChartsOption, 'tooltip' | 'legend' | 'dataZoom' | 'toolbox' | 'xAxis' | 'grid'> {
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { color: 'var(--foreground)' } },
    grid: { left: 48, right: 16, top: 40, bottom: 48 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18 }],
    toolbox: { feature: { restore: {} } },
    xAxis: { type: 'category', data: times, axisLabel: { color: 'var(--muted-foreground)' } },
  };
}
