import {
  MONITOR_TARGET_TYPES,
  MonitorContractError,
  externalIdError,
  type MonitorIntervalMode,
  type MonitorTargetType,
} from './monitor-targets';
import {
  bigintToJson,
  parseMonitorPage,
  parseMonitorPageSize,
  type BigIntString,
  type Paginated,
} from './monitor';

export const MONITOR_CARD_FILTERS = ['all', 'active', 'paused', 'unmonitored'] as const;
export type MonitorCardFilter = (typeof MONITOR_CARD_FILTERS)[number];

export const MONITOR_CARD_STATES = ['unmonitored', 'active', 'paused'] as const;
export type MonitorCardState = (typeof MONITOR_CARD_STATES)[number];

export const MONITOR_EXECUTION_STATES = ['waiting', 'running', 'failed', 'none'] as const;
export type MonitorExecutionState = (typeof MONITOR_EXECUTION_STATES)[number];

const MAX_QUERY_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 80;

export type MonitorCardProject = {
  id: string;
  name: string;
};

export type MonitorCardTarget = {
  id: string;
  label: string;
  tags: string[];
  enabled: boolean;
  intervalMinutes: number;
  intervalMode: MonitorIntervalMode;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
};

export type MonitorCardLatest = {
  sampledAt: string | null;
  viewCount: BigIntString | null;
  onlineViewers: BigIntString | null;
  onlineViewersRaw: string | null;
  likeCount: BigIntString | null;
  followerCount: BigIntString | null;
};

export type MonitorCard = {
  type: MonitorTargetType;
  externalId: string;
  title: string | null;
  category: string | null;
  imageAssetId: string | null;
  mid: string | null;
  displayName: string;
  hasEntity: boolean;
  hasSamples: boolean;
  monitorState: MonitorCardState;
  execution: MonitorExecutionState;
  target: MonitorCardTarget | null;
  projects: MonitorCardProject[];
  latest: MonitorCardLatest;
};

export type MonitorCardListQuery = {
  type: MonitorTargetType;
  monitor: MonitorCardFilter;
  page: number;
  pageSize: number;
  q: string | null;
  category: string | null;
};

export type MonitorExternalInput =
  { ok: true; externalId: string } | { ok: false; message: string };

const VIDEO_BV = /BV[1-9A-HJ-NP-Za-km-z]{10}/;
const SHORT_HOST = /(^|\.)b23\.tv$/i;
const SPACE_HOST = /^space\.bilibili\.com$/i;
const VIDEO_HOST = /^(?:www\.|m\.)?bilibili\.com$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function monitorCardDisplayName(
  title: string | null,
  label: string | null,
  externalId: string,
): string {
  const titleText = title?.trim() ?? '';
  if (titleText) return titleText;
  const labelText = label?.trim() ?? '';
  if (labelText) return labelText;
  return externalId;
}

export function deriveMonitorCardState(input: {
  hasTarget: boolean;
  enabled: boolean | null;
  hasRunning: boolean;
  hasPending: boolean;
  lastError: string | null;
}): { monitorState: MonitorCardState; execution: MonitorExecutionState } {
  const monitorState: MonitorCardState = !input.hasTarget
    ? 'unmonitored'
    : input.enabled
      ? 'active'
      : 'paused';
  let execution: MonitorExecutionState = 'none';
  if (input.hasTarget) {
    if (input.hasRunning) execution = 'running';
    else if (input.hasPending) execution = 'waiting';
    else if (input.lastError) execution = 'failed';
  }
  return { monitorState, execution };
}

function emptyMessage(type: MonitorTargetType): string {
  return type === 'video' ? '请输入 BV 号或视频长链接' : '请输入 UID 或空间长链接';
}

function unsupportedMessage(type: MonitorTargetType): string {
  return type === 'video'
    ? '无法识别。请粘贴完整 BV 号，或 www.bilibili.com/video/BV… 长链接。短链不会发起请求。'
    : '无法识别。请粘贴完整 UID，或 space.bilibili.com/UID 长链接。短链不会发起请求。';
}

function mismatchMessage(type: MonitorTargetType): string {
  return type === 'video' ? '这是 UP 主身份，请到 UP 主页添加' : '这是视频身份，请到视频页添加';
}

function withProtocol(raw: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (/^(?:www\.|m\.|space\.)?bilibili\.com\//i.test(raw)) return `https://${raw}`;
  return raw;
}

function rejectShortLink(hostname: string): boolean {
  return SHORT_HOST.test(hostname) || hostname.toLowerCase() === 'bilibili.tv';
}

/**
 * Local extraction only. Standard long links are parsed with the URL parser.
 * Short hosts are rejected and never fetched.
 */
export function parseMonitorExternalInput(
  type: MonitorTargetType,
  raw: string,
): MonitorExternalInput {
  const text = raw.trim();
  if (!text) return { ok: false, message: emptyMessage(type) };
  const candidate = withProtocol(text);
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:/i.test(candidate);
  if (!looksLikeUrl) {
    const idError = externalIdError(type, text);
    if (!idError) return { ok: true, externalId: text };
    const other = type === 'video' ? 'creator' : 'video';
    if (!externalIdError(other, text)) return { ok: false, message: mismatchMessage(type) };
    return { ok: false, message: idError };
  }
  if (!/^https?:\/\//i.test(candidate)) {
    return { ok: false, message: unsupportedMessage(type) };
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, message: unsupportedMessage(type) };
  }
  if (url.username || url.password) return { ok: false, message: unsupportedMessage(type) };
  const host = url.hostname.toLowerCase();
  if (rejectShortLink(host)) {
    return {
      ok: false,
      message: '暂不支持短链，也不会为识别它访问网络。请粘贴完整 BV/UID 或标准长链接。',
    };
  }
  if (SPACE_HOST.test(host)) {
    const match = url.pathname.match(/^\/(\d+)(?:\/|$)/);
    if (!match?.[1]) return { ok: false, message: unsupportedMessage(type) };
    if (type !== 'creator') return { ok: false, message: mismatchMessage(type) };
    const idError = externalIdError('creator', match[1]);
    if (idError) return { ok: false, message: idError };
    return { ok: true, externalId: match[1] };
  }
  if (VIDEO_HOST.test(host)) {
    const match = url.pathname.match(/^\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10})(?:\/|$)/);
    if (!match?.[1]) return { ok: false, message: unsupportedMessage(type) };
    if (type !== 'video') return { ok: false, message: mismatchMessage(type) };
    if (!VIDEO_BV.test(match[1]) || externalIdError('video', match[1])) {
      return { ok: false, message: 'BV 号格式不正确' };
    }
    return { ok: true, externalId: match[1] };
  }
  return { ok: false, message: unsupportedMessage(type) };
}

function boundedText(
  raw: string | undefined,
  max: number,
  code: string,
  message: string,
): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  const text = raw.trim();
  if (text.length > max) throw new MonitorContractError(code, message);
  return text;
}

export function parseMonitorCardListQuery(input: {
  type?: string | undefined;
  monitor?: string | undefined;
  page?: string | undefined;
  pageSize?: string | undefined;
  q?: string | undefined;
  category?: string | undefined;
}): MonitorCardListQuery {
  if (input.type !== 'video' && input.type !== 'creator') {
    throw new MonitorContractError('invalid_target_type', '卡片类型只能是视频或 UP 主');
  }
  const monitor = input.monitor ?? 'all';
  if (!(MONITOR_CARD_FILTERS as readonly string[]).includes(monitor)) {
    throw new MonitorContractError('invalid_monitor_filter', '监控筛选不正确');
  }
  let page: number;
  let pageSize: number;
  try {
    page = parseMonitorPage(input.page);
    pageSize = parseMonitorPageSize(input.pageSize);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid page';
    throw new MonitorContractError(
      'invalid_page',
      message.includes('pageSize') ? '每页条数不正确' : '页码不正确',
    );
  }
  return {
    type: input.type,
    monitor: monitor as MonitorCardFilter,
    page,
    pageSize,
    q: boundedText(input.q, MAX_QUERY_LENGTH, 'invalid_query', '搜索词过长'),
    category: boundedText(input.category, MAX_CATEGORY_LENGTH, 'invalid_category', '分类筛选过长'),
  };
}

export function parseMonitorCardIdentity(
  type: string,
  externalId: string,
): {
  type: MonitorTargetType;
  externalId: string;
} {
  if (!(MONITOR_TARGET_TYPES as readonly string[]).includes(type)) {
    throw new MonitorContractError('invalid_target_type', '卡片类型只能是视频或 UP 主');
  }
  const kind = type as MonitorTargetType;
  const id = externalId.trim();
  const idError = externalIdError(kind, id);
  if (idError) throw new MonitorContractError('invalid_external_id', idError);
  return { type: kind, externalId: id };
}

function parseLatest(value: unknown): MonitorCardLatest {
  if (!isRecord(value)) throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  const sampledAt = value.sampledAt;
  if (sampledAt !== null && typeof sampledAt !== 'string') {
    throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  }
  const text = (field: string): string | null => {
    const item = value[field];
    if (item === null) return null;
    if (typeof item !== 'string')
      throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
    return item;
  };
  return {
    sampledAt,
    viewCount: text('viewCount'),
    onlineViewers: text('onlineViewers'),
    onlineViewersRaw: text('onlineViewersRaw'),
    likeCount: text('likeCount'),
    followerCount: text('followerCount'),
  };
}

function parseTarget(value: unknown): MonitorCardTarget | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  if (typeof value.id !== 'string' || typeof value.label !== 'string') {
    throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  }
  if (typeof value.enabled !== 'boolean') {
    throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  }
  if (value.intervalMode !== 'auto' && value.intervalMode !== 'fixed') {
    throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  }
  if (typeof value.intervalMinutes !== 'number') {
    throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  }
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string')) {
    throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  }
  const optionalTime = (field: string): string | null => {
    const item = value[field];
    if (item === null) return null;
    if (typeof item !== 'string')
      throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
    return item;
  };
  const lastError = value.lastError;
  if (lastError !== null && typeof lastError !== 'string') {
    throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  }
  return {
    id: value.id,
    label: value.label,
    tags: value.tags,
    enabled: value.enabled,
    intervalMinutes: value.intervalMinutes,
    intervalMode: value.intervalMode,
    nextRunAt: optionalTime('nextRunAt'),
    lastRunAt: optionalTime('lastRunAt'),
    lastSuccessAt: optionalTime('lastSuccessAt'),
    lastError,
  };
}

function parseProjects(value: unknown): MonitorCardProject[] {
  if (!Array.isArray(value)) throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') {
      throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
    }
    return { id: item.id, name: item.name };
  });
}

export function parseMonitorCard(value: unknown): MonitorCard {
  if (!isRecord(value)) throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  if (value.type !== 'video' && value.type !== 'creator') {
    throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  }
  if (typeof value.externalId !== 'string' || typeof value.displayName !== 'string') {
    throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  }
  if (typeof value.hasEntity !== 'boolean' || typeof value.hasSamples !== 'boolean') {
    throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  }
  if (!(MONITOR_CARD_STATES as readonly string[]).includes(String(value.monitorState))) {
    throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  }
  if (!(MONITOR_EXECUTION_STATES as readonly string[]).includes(String(value.execution))) {
    throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
  }
  const optionalString = (field: string): string | null => {
    const item = value[field];
    if (item === null) return null;
    if (typeof item !== 'string')
      throw new MonitorContractError('invalid_body', '监控卡片响应不完整');
    return item;
  };
  if ('monitoringEnabled' in value) {
    throw new MonitorContractError('invalid_body', '监控卡片不能携带旧的 monitoringEnabled');
  }
  return {
    type: value.type,
    externalId: value.externalId,
    title: optionalString('title'),
    category: optionalString('category'),
    imageAssetId: optionalString('imageAssetId'),
    mid: optionalString('mid'),
    displayName: value.displayName,
    hasEntity: value.hasEntity,
    hasSamples: value.hasSamples,
    monitorState: value.monitorState as MonitorCardState,
    execution: value.execution as MonitorExecutionState,
    target: parseTarget(value.target),
    projects: parseProjects(value.projects),
    latest: parseLatest(value.latest),
  };
}

export function parseMonitorCardList(value: unknown): Paginated<MonitorCard> {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new MonitorContractError('invalid_body', '监控卡片列表不完整');
  }
  if (
    typeof value.page !== 'number' ||
    typeof value.pageSize !== 'number' ||
    typeof value.totalItems !== 'number' ||
    typeof value.totalPages !== 'number'
  ) {
    throw new MonitorContractError('invalid_body', '监控卡片列表不完整');
  }
  return {
    page: value.page,
    pageSize: value.pageSize,
    totalItems: value.totalItems,
    totalPages: value.totalPages,
    items: value.items.map(parseMonitorCard),
  };
}

export function jsonBigint(value: bigint | string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return bigintToJson(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.trunc(value).toString();
  }
  if (!/^-?\d+$/.test(value)) return null;
  return BigInt(value).toString();
}
