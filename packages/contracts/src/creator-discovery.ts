import { parseCreatorMid, parseMonitorPage, parseMonitorPageSize, type Paginated } from './monitor';
import { MonitorContractError } from './monitor-targets';

export type CreatorPublishEventKind = 'video' | 'dynamic';

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export type CreatorDiscoveryConfig = {
  mid: string;
  enabled: boolean;
  discoverVideos: boolean;
  discoverDynamics: boolean;
  monitorNewVideos: boolean;
  discoveryTargetId: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastRunAt: string | null;
  suppressedAutoCreateTotal: number;
  updatedAt: string | null;
};

export type CreatorDiscoveryConfigPutRequest = {
  enabled: boolean;
  discoverVideos: boolean;
  discoverDynamics: boolean;
  monitorNewVideos: boolean;
};

export type CreatorPublishEvent = {
  id: string;
  mid: string;
  eventKind: CreatorPublishEventKind;
  externalId: string;
  publishedAt: string;
  titleSnapshot: string;
  firstDiscoveredAt: string;
  source: 'bilibili';
  monitored: boolean;
  monitoredTargetId: string | null;
  /** True when the event is a monitored video and the UI may navigate to its detail. */
  navigable: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new MonitorContractError('invalid_body', `${field} 必须是字符串`);
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new MonitorContractError('invalid_body', `${field} 必须是布尔值`);
  }
  return value;
}

function asNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return asString(value, field);
}

function asIso(value: unknown, field: string): string {
  const raw = asString(value, field);
  if (!ISO_INSTANT.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new MonitorContractError('invalid_body', `${field} 必须是合法时间`);
  }
  return new Date(raw).toISOString();
}

function asNullableIso(value: unknown, field: string): string | null {
  if (value === null) return null;
  return asIso(value, field);
}

export function parseCreatorDiscoveryConfigPutRequest(
  value: unknown,
): CreatorDiscoveryConfigPutRequest {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '请求体必须是对象');
  }
  for (const key of Object.keys(value)) {
    if (
      key !== 'enabled' &&
      key !== 'discoverVideos' &&
      key !== 'discoverDynamics' &&
      key !== 'monitorNewVideos'
    ) {
      throw new MonitorContractError('invalid_body', `不能识别的字段 ${key}`);
    }
  }
  const enabled = asBoolean(value.enabled, 'enabled');
  const discoverVideos = asBoolean(value.discoverVideos, 'discoverVideos');
  const discoverDynamics = asBoolean(value.discoverDynamics, 'discoverDynamics');
  const monitorNewVideos = asBoolean(value.monitorNewVideos, 'monitorNewVideos');
  if (enabled && !discoverVideos && !discoverDynamics) {
    throw new MonitorContractError('invalid_body', '开启发现时至少勾选视频或动态');
  }
  if (monitorNewVideos && !discoverVideos) {
    throw new MonitorContractError('invalid_body', '同时监控新视频数据需要先开启发现视频');
  }
  if (!enabled && monitorNewVideos) {
    throw new MonitorContractError('invalid_body', '关闭发现时不能开启同时监控新视频');
  }
  return { enabled, discoverVideos, discoverDynamics, monitorNewVideos };
}

export function parseCreatorDiscoveryConfig(value: unknown): CreatorDiscoveryConfig {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '发现配置必须是对象');
  }
  return {
    mid: parseCreatorMid(asString(value.mid, 'mid')),
    enabled: asBoolean(value.enabled, 'enabled'),
    discoverVideos: asBoolean(value.discoverVideos, 'discoverVideos'),
    discoverDynamics: asBoolean(value.discoverDynamics, 'discoverDynamics'),
    monitorNewVideos: asBoolean(value.monitorNewVideos, 'monitorNewVideos'),
    discoveryTargetId: asNullableString(value.discoveryTargetId, 'discoveryTargetId'),
    lastSuccessAt: asNullableIso(value.lastSuccessAt, 'lastSuccessAt'),
    lastError: asNullableString(value.lastError, 'lastError'),
    lastRunAt: asNullableIso(value.lastRunAt, 'lastRunAt'),
    suppressedAutoCreateTotal: (() => {
      if (typeof value.suppressedAutoCreateTotal !== 'number') {
        throw new MonitorContractError('invalid_body', 'suppressedAutoCreateTotal 必须是数字');
      }
      if (
        !Number.isInteger(value.suppressedAutoCreateTotal) ||
        value.suppressedAutoCreateTotal < 0
      ) {
        throw new MonitorContractError('invalid_body', 'suppressedAutoCreateTotal 非法');
      }
      return value.suppressedAutoCreateTotal;
    })(),
    updatedAt: asNullableIso(value.updatedAt, 'updatedAt'),
  };
}

export function parseCreatorPublishEvent(value: unknown): CreatorPublishEvent {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '发布事件必须是对象');
  }
  const eventKind = asString(value.eventKind, 'eventKind');
  if (eventKind !== 'video' && eventKind !== 'dynamic') {
    throw new MonitorContractError('invalid_body', 'eventKind 非法');
  }
  const monitored = asBoolean(value.monitored, 'monitored');
  const monitoredTargetId = asNullableString(value.monitoredTargetId, 'monitoredTargetId');
  const navigable = asBoolean(value.navigable, 'navigable');
  if (navigable && (eventKind !== 'video' || !monitored || !monitoredTargetId)) {
    throw new MonitorContractError('invalid_body', 'navigable 与监控状态不一致');
  }
  return {
    id: asString(value.id, 'id'),
    mid: parseCreatorMid(asString(value.mid, 'mid')),
    eventKind,
    externalId: asString(value.externalId, 'externalId'),
    publishedAt: asIso(value.publishedAt, 'publishedAt'),
    titleSnapshot: asString(value.titleSnapshot, 'titleSnapshot'),
    firstDiscoveredAt: asIso(value.firstDiscoveredAt, 'firstDiscoveredAt'),
    source: 'bilibili',
    monitored,
    monitoredTargetId,
    navigable,
  };
}

export function parseCreatorPublishEventList(value: unknown): Paginated<CreatorPublishEvent> {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '发布事件列表必须是对象');
  }
  if (!Array.isArray(value.items)) {
    throw new MonitorContractError('invalid_body', 'items 必须是数组');
  }
  const page =
    typeof value.page === 'number' ? value.page : parseMonitorPage(String(value.page ?? ''));
  const pageSize =
    typeof value.pageSize === 'number'
      ? value.pageSize
      : parseMonitorPageSize(String(value.pageSize ?? ''));
  if (!Number.isInteger(page) || page < 1) {
    throw new MonitorContractError('invalid_body', 'page 非法');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new MonitorContractError('invalid_body', 'pageSize 非法');
  }
  return {
    page,
    pageSize,
    totalItems: (() => {
      if (typeof value.totalItems !== 'number' || !Number.isInteger(value.totalItems)) {
        throw new MonitorContractError('invalid_body', 'totalItems 非法');
      }
      return value.totalItems;
    })(),
    totalPages: (() => {
      if (typeof value.totalPages !== 'number' || !Number.isInteger(value.totalPages)) {
        throw new MonitorContractError('invalid_body', 'totalPages 非法');
      }
      return value.totalPages;
    })(),
    items: value.items.map(parseCreatorPublishEvent),
  };
}

export function parsePublishEventsQuery(search: URLSearchParams): {
  from: Date | null;
  to: Date | null;
  page: number;
  pageSize: number;
} {
  const page = parseMonitorPage(search.get('page') ?? undefined);
  const pageSize = Math.min(parseMonitorPageSize(search.get('pageSize') ?? '100'), 200);
  const fromRaw = search.get('from');
  const toRaw = search.get('to');
  let from: Date | null = null;
  let to: Date | null = null;
  if (fromRaw) {
    if (!ISO_INSTANT.test(fromRaw) || Number.isNaN(Date.parse(fromRaw))) {
      throw new MonitorContractError('invalid_query', 'from 必须是合法时间');
    }
    from = new Date(fromRaw);
  }
  if (toRaw) {
    if (!ISO_INSTANT.test(toRaw) || Number.isNaN(Date.parse(toRaw))) {
      throw new MonitorContractError('invalid_query', 'to 必须是合法时间');
    }
    to = new Date(toRaw);
  }
  if (from && to && from.getTime() > to.getTime()) {
    throw new MonitorContractError('invalid_query', 'from 不能晚于 to');
  }
  return { from, to, page, pageSize };
}
