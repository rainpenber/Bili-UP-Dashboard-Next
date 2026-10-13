export type MonitorTab = 'videos' | 'creators' | 'dynamics';

export type MonitorUrlState = {
  tab: MonitorTab;
  page: number;
  category: string;
  q: string;
  selected: string | null;
};

const TAB_VALUES: MonitorTab[] = ['videos', 'creators', 'dynamics'];

export function parseMonitorSearchParams(params: URLSearchParams): MonitorUrlState {
  const rawTab = params.get('tab');
  const tab = TAB_VALUES.includes(rawTab as MonitorTab) ? (rawTab as MonitorTab) : 'videos';
  const pageRaw = Number(params.get('page') ?? '1');
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  return {
    tab,
    page,
    category: params.get('category') ?? '',
    q: params.get('q') ?? '',
    selected: params.get('selected'),
  };
}

export function writeMonitorSearchParams(
  current: URLSearchParams,
  patch: Partial<MonitorUrlState>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const merged: MonitorUrlState = { ...parseMonitorSearchParams(current), ...patch };

  next.set('tab', merged.tab);
  next.set('page', String(merged.page));
  if (merged.category) next.set('category', merged.category);
  else next.delete('category');
  if (merged.q) next.set('q', merged.q);
  else next.delete('q');
  if (merged.selected) next.set('selected', merged.selected);
  else next.delete('selected');
  return next;
}

export function entityIdForTab(state: MonitorUrlState): string | null {
  return state.selected;
}
