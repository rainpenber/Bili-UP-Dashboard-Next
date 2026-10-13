const CHART_VARS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'] as const;
const UI_VARS = ['--foreground', '--muted-foreground', '--border'] as const;

export type ResolvedChartColors = {
  series: [string, string, string, string, string];
  foreground: string;
  mutedForeground: string;
  border: string;
  background: string;
};

function readCssVar(name: string, el: Element): string {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw) return '#888888';
  return raw;
}

export function resolveChartColors(root: Element = document.documentElement): ResolvedChartColors {
  const series = CHART_VARS.map((v) => readCssVar(v, root)) as ResolvedChartColors['series'];
  return {
    series,
    foreground: readCssVar('--foreground', root),
    mutedForeground: readCssVar('--muted-foreground', root),
    border: readCssVar('--border', root),
    background: readCssVar('--background', root),
  };
}

export function chartSemanticFromResolved(colors: ResolvedChartColors) {
  return {
    series1: colors.series[0],
    series2: colors.series[1],
    series3: colors.series[2],
    series4: colors.series[3],
    series5: colors.series[4],
  };
}

export function subscribeChartColorUpdates(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined;
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-accent'],
  });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onMq = () => onChange();
  mq.addEventListener('change', onMq);
  return () => {
    observer.disconnect();
    mq.removeEventListener('change', onMq);
  };
}

export { CHART_VARS, UI_VARS };
