import { MonitorContractError } from './monitor-targets';

export const MONITOR_SEARCH_SUGGESTION_KINDS = ['video', 'creator', 'category'] as const;
export type MonitorSearchSuggestionKind = (typeof MONITOR_SEARCH_SUGGESTION_KINDS)[number];

export const MONITOR_SEARCH_SUGGESTION_TYPES = ['video', 'creator'] as const;
export type MonitorSearchSuggestionType = (typeof MONITOR_SEARCH_SUGGESTION_TYPES)[number];

/** Per-group cap for suggestion lists (video / creator / category). */
export const MONITOR_SEARCH_SUGGESTION_GROUP_LIMIT = 5;
export const MONITOR_SEARCH_SUGGESTION_MAX_LIMIT = 5;
export const MONITOR_SEARCH_SUGGESTION_DEFAULT_LIMIT = 5;
const MAX_QUERY_LENGTH = 120;

export type MonitorSearchSuggestionItem = {
  kind: MonitorSearchSuggestionKind;
  /** Primary readable label (title / UP name / category name). Never BV/MID alone. */
  label: string;
  /**
   * Secondary gray hint only: video → UP name; creator → fixed「UP 主」; category → null.
   * Never BV / MID / UID — those stay in `value` for exact apply.
   */
  secondary: string | null;
  /**
   * Apply value: video bvid, creator mid, or exact category name.
   * Used for selection / exact filters; not the default visible draft when label differs.
   */
  value: string;
};

export type MonitorSearchSuggestionsQuery = {
  q: string;
  type: MonitorSearchSuggestionType;
  limit: number;
};

export type MonitorSearchSuggestionsResponse = {
  q: string;
  type: MonitorSearchSuggestionType;
  limit: number;
  videos: MonitorSearchSuggestionItem[];
  creators: MonitorSearchSuggestionItem[];
  categories: MonitorSearchSuggestionItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return MONITOR_SEARCH_SUGGESTION_DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new MonitorContractError('invalid_limit', '建议条数不正确');
  }
  return Math.min(MONITOR_SEARCH_SUGGESTION_MAX_LIMIT, Math.floor(n));
}

export function parseMonitorSearchSuggestionsQuery(input: {
  q?: string | undefined;
  type?: string | undefined;
  limit?: string | undefined;
}): MonitorSearchSuggestionsQuery {
  if (input.type !== 'video' && input.type !== 'creator') {
    throw new MonitorContractError('invalid_target_type', '建议类型只能是视频或 UP 主');
  }
  const q = (input.q ?? '').trim();
  if (q.length > MAX_QUERY_LENGTH) {
    throw new MonitorContractError('invalid_query', '搜索词过长');
  }
  return {
    q,
    type: input.type,
    limit: parseLimit(input.limit),
  };
}

function parseItem(
  value: unknown,
  expected: MonitorSearchSuggestionKind,
): MonitorSearchSuggestionItem {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_suggestion', '搜索建议格式不正确');
  }
  if (value.kind !== expected) {
    throw new MonitorContractError('invalid_suggestion', '搜索建议类型不正确');
  }
  if (typeof value.label !== 'string' || value.label.trim() === '') {
    throw new MonitorContractError('invalid_suggestion', '搜索建议缺少可读名称');
  }
  if (typeof value.value !== 'string' || value.value.trim() === '') {
    throw new MonitorContractError('invalid_suggestion', '搜索建议缺少取值');
  }
  if (value.secondary !== null && typeof value.secondary !== 'string') {
    throw new MonitorContractError('invalid_suggestion', '搜索建议次要信息不正确');
  }
  return {
    kind: expected,
    label: value.label.trim(),
    secondary: value.secondary === null || value.secondary === '' ? null : value.secondary,
    value: value.value.trim(),
  };
}

function parseGroup(
  value: unknown,
  expected: MonitorSearchSuggestionKind,
  limit: number,
): MonitorSearchSuggestionItem[] {
  if (!Array.isArray(value)) {
    throw new MonitorContractError('invalid_suggestion_list', '搜索建议列表不正确');
  }
  if (value.length > limit) {
    throw new MonitorContractError('invalid_suggestion_list', '搜索建议数量超出限制');
  }
  return value.map((item) => parseItem(item, expected));
}

export function parseMonitorSearchSuggestionsResponse(
  value: unknown,
): MonitorSearchSuggestionsResponse {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '搜索建议响应不正确');
  }
  if (typeof value.q !== 'string') {
    throw new MonitorContractError('invalid_query', '搜索词不正确');
  }
  if (value.type !== 'video' && value.type !== 'creator') {
    throw new MonitorContractError('invalid_target_type', '建议类型只能是视频或 UP 主');
  }
  if (typeof value.limit !== 'number' || !Number.isFinite(value.limit) || value.limit < 1) {
    throw new MonitorContractError('invalid_limit', '建议条数不正确');
  }
  const limit = Math.min(MONITOR_SEARCH_SUGGESTION_MAX_LIMIT, Math.floor(value.limit));
  return {
    q: value.q,
    type: value.type,
    limit,
    videos: parseGroup(value.videos, 'video', limit),
    creators: parseGroup(value.creators, 'creator', limit),
    categories: parseGroup(value.categories, 'category', limit),
  };
}
