import {
  DEFAULT_MONITOR_CREATOR_CARD_SORT,
  DEFAULT_MONITOR_DYNAMIC_SORT,
  DEFAULT_MONITOR_VIDEO_CARD_SORT,
  MONITOR_CREATOR_CARD_SORTS,
  MONITOR_DYNAMIC_SORTS,
  MONITOR_VIDEO_CARD_SORTS,
  type MonitorCreatorCardSort,
  type MonitorDynamicSort,
  type MonitorVideoCardSort,
} from '@studio/contracts';

export type MonitorTab = 'videos' | 'creators' | 'dynamics';

export const MONITOR_PRESENCE_FILTERS = ['all', 'active', 'paused', 'unmonitored'] as const;
export type MonitorPresenceFilter = (typeof MONITOR_PRESENCE_FILTERS)[number];

export const MONITOR_VIEWS = ['split', 'grid'] as const;
export type MonitorView = (typeof MONITOR_VIEWS)[number];

export const MONITOR_VIDEO_SORTS = MONITOR_VIDEO_CARD_SORTS;
export type MonitorVideoSort = MonitorVideoCardSort;
export const DEFAULT_MONITOR_VIDEO_SORT = DEFAULT_MONITOR_VIDEO_CARD_SORT;

export const MONITOR_CREATOR_SORTS = MONITOR_CREATOR_CARD_SORTS;
export type MonitorCreatorSort = MonitorCreatorCardSort;
export const DEFAULT_MONITOR_CREATOR_SORT = DEFAULT_MONITOR_CREATOR_CARD_SORT;

export const MONITOR_DYNAMIC_LIST_SORTS = MONITOR_DYNAMIC_SORTS;
export type MonitorDynamicListSort = MonitorDynamicSort;
export const DEFAULT_MONITOR_DYNAMIC_LIST_SORT = DEFAULT_MONITOR_DYNAMIC_SORT;

export type MonitorListSort = MonitorVideoSort | MonitorCreatorSort | MonitorDynamicListSort;

export type MonitorUrlState = {
  tab: MonitorTab;
  page: number;
  category: string;
  q: string;
  selected: string | null;
  monitor: MonitorPresenceFilter;
  view: MonitorView;
  /** Tab-scoped sort; parsed against the active tab's allowed values. */
  sort: MonitorListSort;
  /**
   * Video list「只看我的」. Default off (omitted from URL).
   * Kept across tabs so back/forward and detail return preserve it.
   */
  onlyMine: boolean;
};

const TAB_VALUES: MonitorTab[] = ['videos', 'creators', 'dynamics'];

export function defaultSortForTab(tab: MonitorTab): MonitorListSort {
  if (tab === 'creators') return DEFAULT_MONITOR_CREATOR_SORT;
  if (tab === 'dynamics') return DEFAULT_MONITOR_DYNAMIC_LIST_SORT;
  return DEFAULT_MONITOR_VIDEO_SORT;
}

export function parseSortForTab(tab: MonitorTab, raw: string | null): MonitorListSort {
  if (tab === 'videos') {
    return MONITOR_VIDEO_SORTS.includes(raw as MonitorVideoSort)
      ? (raw as MonitorVideoSort)
      : DEFAULT_MONITOR_VIDEO_SORT;
  }
  if (tab === 'creators') {
    return MONITOR_CREATOR_SORTS.includes(raw as MonitorCreatorSort)
      ? (raw as MonitorCreatorSort)
      : DEFAULT_MONITOR_CREATOR_SORT;
  }
  return MONITOR_DYNAMIC_LIST_SORTS.includes(raw as MonitorDynamicListSort)
    ? (raw as MonitorDynamicListSort)
    : DEFAULT_MONITOR_DYNAMIC_LIST_SORT;
}

export function parseMonitorSearchParams(params: URLSearchParams): MonitorUrlState {
  const rawTab = params.get('tab');
  const tab: MonitorTab =
    rawTab === 'targets' || rawTab === null || !TAB_VALUES.includes(rawTab as MonitorTab)
      ? rawTab === 'creators' || rawTab === 'dynamics'
        ? (rawTab as MonitorTab)
        : 'videos'
      : (rawTab as MonitorTab);
  const pageRaw = Number(params.get('page') ?? '1');
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const rawMonitor = params.get('monitor');
  const monitor = MONITOR_PRESENCE_FILTERS.includes(rawMonitor as MonitorPresenceFilter)
    ? (rawMonitor as MonitorPresenceFilter)
    : 'all';
  const rawView = params.get('view');
  const view: MonitorView = rawView === 'grid' ? 'grid' : 'split';
  const sort = parseSortForTab(tab, params.get('sort'));
  const rawMine = params.get('onlyMine') ?? params.get('mine');
  const onlyMine = rawMine === '1' || rawMine === 'true';
  return {
    tab,
    page,
    category: params.get('category') ?? '',
    q: params.get('q') ?? '',
    selected: params.get('selected'),
    monitor,
    view,
    sort,
    onlyMine,
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
  if (merged.monitor !== 'all') next.set('monitor', merged.monitor);
  else next.delete('monitor');
  if (merged.view === 'grid') next.set('view', 'grid');
  else next.delete('view');
  const defaultSort = defaultSortForTab(merged.tab);
  const sortValid = parseSortForTab(merged.tab, String(merged.sort)) === merged.sort;
  if (sortValid && merged.sort !== defaultSort) next.set('sort', merged.sort);
  else next.delete('sort');
  if (merged.onlyMine) next.set('onlyMine', '1');
  else next.delete('onlyMine');
  next.delete('mine');
  next.delete('targets');
  return next;
}

export function entityIdForTab(state: MonitorUrlState): string | null {
  return state.selected;
}

export function monitorListHref(state: MonitorUrlState): string {
  const params = writeMonitorSearchParams(new URLSearchParams(), state);
  return `/monitoring?${params.toString()}`;
}

export function detailReturnHref(
  kind: 'videos' | 'creators' | 'dynamics',
  from: string | null,
): string {
  if (!from) return `/monitoring?tab=${kind}`;
  return `/monitoring?${from}`;
}
