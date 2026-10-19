import { parseMonitorPage, parseMonitorPageSize, type Paginated } from './monitor';

export const MONITOR_TARGET_TYPES = ['video', 'creator'] as const;
export type MonitorTargetType = (typeof MONITOR_TARGET_TYPES)[number];

export const MONITOR_INTERVAL_MINUTES = [5, 15, 30, 60, 180, 360, 720, 1440] as const;
export type MonitorIntervalMinutes = (typeof MONITOR_INTERVAL_MINUTES)[number];

export const COLLECTOR_JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;
export type CollectorJobStatus = (typeof COLLECTOR_JOB_STATUSES)[number];

export const COLLECTOR_RUN_STATUSES = ['succeeded', 'failed'] as const;
export type CollectorRunStatus = (typeof COLLECTOR_RUN_STATUSES)[number];

const VIDEO_EXTERNAL_ID = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
const CREATOR_EXTERNAL_ID = /^[1-9][0-9]{0,18}$/;
const MAX_CREATOR_MID = 9223372036854775807n;
const TARGET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAG_VALUE = /^[\p{L}\p{N}_.-]{1,24}$/u;
const MAX_TAGS = 8;
const MAX_LABEL = 80;

export class MonitorContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MonitorContractError';
    this.code = code;
  }
}

export type MonitorTarget = {
  id: string;
  type: MonitorTargetType;
  externalId: string;
  label: string;
  tags: string[];
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type MonitorTargetCreateRequest = {
  type: MonitorTargetType;
  externalId: string;
  label: string;
  tags: string[];
  intervalMinutes: MonitorIntervalMinutes;
};

export type MonitorTargetPatchRequest = {
  enabled?: boolean;
  intervalMinutes?: MonitorIntervalMinutes;
  tags?: string[];
  label?: string;
};

export type MonitorTargetCreateResponse = {
  target: MonitorTarget;
  created: boolean;
  code: 'created' | 'target_exists';
  message: string;
};

export type CollectorRunSummary = {
  id: string;
  status: CollectorRunStatus;
  samplesWritten: number;
  durationMs: number;
  error: string | null;
  finishedAt: string;
};

export type CollectorJob = {
  id: string;
  targetId: string;
  targetType: MonitorTargetType;
  externalId: string;
  status: CollectorJobStatus;
  attempts: number;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  latestRun: CollectorRunSummary | null;
};

export type MonitorTargetRunResponse = {
  job: CollectorJob;
  created: boolean;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new MonitorContractError('invalid_body', `不能识别的字段 ${key}`);
    }
  }
}

export function isMonitorIntervalMinutes(value: number): value is MonitorIntervalMinutes {
  return (MONITOR_INTERVAL_MINUTES as readonly number[]).includes(value);
}

export function externalIdError(type: MonitorTargetType, externalId: string): string | null {
  if (type === 'video') {
    return VIDEO_EXTERNAL_ID.test(externalId) ? null : 'BV 号格式不正确';
  }
  if (!CREATOR_EXTERNAL_ID.test(externalId)) return 'UID 格式不正确';
  try {
    if (BigInt(externalId) > MAX_CREATOR_MID) return 'UID 超出可存储范围';
  } catch {
    return 'UID 格式不正确';
  }
  return null;
}

export function parseMonitorTargetId(raw: string): string {
  const id = raw.trim();
  if (!TARGET_ID.test(id)) {
    throw new MonitorContractError('invalid_target_id', '监控项编号不正确');
  }
  return id;
}

function parseTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new MonitorContractError('invalid_tags', '标签必须是字符串列表');
  }
  if (value.length > MAX_TAGS) {
    throw new MonitorContractError('invalid_tags', `标签最多 ${MAX_TAGS} 个`);
  }
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new MonitorContractError('invalid_tags', '标签必须是字符串列表');
    }
    const tag = item.trim();
    if (!TAG_VALUE.test(tag)) {
      throw new MonitorContractError(
        'invalid_tags',
        '标签只能包含字母、数字、点、下划线或连字符，且不超过 24 字',
      );
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function parseLabel(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') {
    throw new MonitorContractError('invalid_body', '名称必须是字符串');
  }
  const label = value.trim();
  if (label.length > MAX_LABEL) {
    throw new MonitorContractError('invalid_body', `名称不能超过 ${MAX_LABEL} 字`);
  }
  return label.length > 0 ? label : fallback;
}

function parseInterval(value: unknown, fallback: MonitorIntervalMinutes): MonitorIntervalMinutes {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || !isMonitorIntervalMinutes(value)) {
    throw new MonitorContractError('invalid_interval', '采集频率不在允许范围内');
  }
  return value;
}

export function parseCreateMonitorTargetRequest(value: unknown): MonitorTargetCreateRequest {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '请求体不是合法的监控项');
  }
  rejectUnknownKeys(value, ['type', 'externalId', 'label', 'tags', 'intervalMinutes']);
  if (value.type !== 'video' && value.type !== 'creator') {
    throw new MonitorContractError('invalid_target_type', '监控类型只能是视频或 UP 主');
  }
  if (typeof value.externalId !== 'string') {
    throw new MonitorContractError(
      'invalid_external_id',
      value.type === 'video' ? 'BV 号格式不正确' : 'UID 格式不正确',
    );
  }
  const externalId = value.externalId.trim();
  const idError = externalIdError(value.type, externalId);
  if (idError) throw new MonitorContractError('invalid_external_id', idError);
  return {
    type: value.type,
    externalId,
    label: parseLabel(value.label, externalId),
    tags: parseTags(value.tags),
    intervalMinutes: parseInterval(value.intervalMinutes, 60),
  };
}

export function parsePatchMonitorTargetRequest(value: unknown): MonitorTargetPatchRequest {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '请求体不是合法的监控项更新');
  }
  rejectUnknownKeys(value, ['enabled', 'intervalMinutes', 'tags', 'label']);
  const patch: MonitorTargetPatchRequest = {};
  if ('enabled' in value) {
    if (typeof value.enabled !== 'boolean') {
      throw new MonitorContractError('invalid_body', '启用状态必须是布尔值');
    }
    patch.enabled = value.enabled;
  }
  if ('intervalMinutes' in value) {
    if (
      typeof value.intervalMinutes !== 'number' ||
      !Number.isInteger(value.intervalMinutes) ||
      !isMonitorIntervalMinutes(value.intervalMinutes)
    ) {
      throw new MonitorContractError('invalid_interval', '采集频率不在允许范围内');
    }
    patch.intervalMinutes = value.intervalMinutes;
  }
  if ('tags' in value) patch.tags = parseTags(value.tags);
  if ('label' in value) {
    if (typeof value.label !== 'string') {
      throw new MonitorContractError('invalid_body', '名称必须是字符串');
    }
    const label = value.label.trim();
    if (label.length === 0 || label.length > MAX_LABEL) {
      throw new MonitorContractError('invalid_body', '名称不能为空，且不超过 80 字');
    }
    patch.label = label;
  }
  if (
    patch.enabled === undefined &&
    patch.intervalMinutes === undefined &&
    patch.tags === undefined &&
    patch.label === undefined
  ) {
    throw new MonitorContractError('invalid_patch', '没有可更新的字段');
  }
  return patch;
}

function parseIso(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new MonitorContractError('invalid_body', `${name} 不是合法时间`);
  }
  return value;
}

export function parseMonitorTarget(value: unknown): MonitorTarget {
  if (!isRecord(value)) throw new MonitorContractError('invalid_body', '监控项响应不完整');
  if (typeof value.id !== 'string')
    throw new MonitorContractError('invalid_body', '监控项响应不完整');
  if (value.type !== 'video' && value.type !== 'creator') {
    throw new MonitorContractError('invalid_body', '监控项响应不完整');
  }
  if (typeof value.externalId !== 'string' || typeof value.label !== 'string') {
    throw new MonitorContractError('invalid_body', '监控项响应不完整');
  }
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string')) {
    throw new MonitorContractError('invalid_body', '监控项响应不完整');
  }
  if (typeof value.enabled !== 'boolean' || typeof value.intervalMinutes !== 'number') {
    throw new MonitorContractError('invalid_body', '监控项响应不完整');
  }
  if (
    typeof value.source !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new MonitorContractError('invalid_body', '监控项响应不完整');
  }
  return {
    id: value.id,
    type: value.type,
    externalId: value.externalId,
    label: value.label,
    tags: value.tags,
    enabled: value.enabled,
    intervalMinutes: value.intervalMinutes,
    nextRunAt: parseIso(value.nextRunAt, 'nextRunAt'),
    lastRunAt: parseIso(value.lastRunAt, 'lastRunAt'),
    lastSuccessAt: parseIso(value.lastSuccessAt, 'lastSuccessAt'),
    lastError:
      value.lastError === null
        ? null
        : typeof value.lastError === 'string'
          ? value.lastError
          : (() => {
              throw new MonitorContractError('invalid_body', '监控项响应不完整');
            })(),
    source: value.source,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: parseIso(value.deletedAt, 'deletedAt'),
  };
}

export function parseMonitorTargetList(value: unknown): Paginated<MonitorTarget> {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new MonitorContractError('invalid_body', '监控项列表响应不完整');
  }
  if (
    typeof value.page !== 'number' ||
    typeof value.pageSize !== 'number' ||
    typeof value.totalItems !== 'number' ||
    typeof value.totalPages !== 'number'
  ) {
    throw new MonitorContractError('invalid_body', '监控项列表响应不完整');
  }
  return {
    page: value.page,
    pageSize: value.pageSize,
    totalItems: value.totalItems,
    totalPages: value.totalPages,
    items: value.items.map((item) => parseMonitorTarget(item)),
  };
}

function parseRunSummary(value: unknown): CollectorRunSummary | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new MonitorContractError('invalid_body', '采集运行记录不完整');
  if (typeof value.id !== 'string' || (value.status !== 'succeeded' && value.status !== 'failed')) {
    throw new MonitorContractError('invalid_body', '采集运行记录不完整');
  }
  if (typeof value.samplesWritten !== 'number' || typeof value.durationMs !== 'number') {
    throw new MonitorContractError('invalid_body', '采集运行记录不完整');
  }
  if (typeof value.finishedAt !== 'string') {
    throw new MonitorContractError('invalid_body', '采集运行记录不完整');
  }
  return {
    id: value.id,
    status: value.status,
    samplesWritten: value.samplesWritten,
    durationMs: value.durationMs,
    error: value.error === null || typeof value.error === 'string' ? value.error : null,
    finishedAt: value.finishedAt,
  };
}

export function parseCollectorJob(value: unknown): CollectorJob {
  if (!isRecord(value)) throw new MonitorContractError('invalid_body', '采集任务响应不完整');
  if (
    typeof value.id !== 'string' ||
    typeof value.targetId !== 'string' ||
    typeof value.externalId !== 'string'
  ) {
    throw new MonitorContractError('invalid_body', '采集任务响应不完整');
  }
  if (value.targetType !== 'video' && value.targetType !== 'creator') {
    throw new MonitorContractError('invalid_body', '采集任务响应不完整');
  }
  if (
    value.status !== 'pending' &&
    value.status !== 'running' &&
    value.status !== 'succeeded' &&
    value.status !== 'failed'
  ) {
    throw new MonitorContractError('invalid_body', '采集任务响应不完整');
  }
  if (typeof value.attempts !== 'number' || typeof value.scheduledFor !== 'string') {
    throw new MonitorContractError('invalid_body', '采集任务响应不完整');
  }
  return {
    id: value.id,
    targetId: value.targetId,
    targetType: value.targetType,
    externalId: value.externalId,
    status: value.status,
    attempts: value.attempts,
    scheduledFor: value.scheduledFor,
    startedAt: parseIso(value.startedAt, 'startedAt'),
    finishedAt: parseIso(value.finishedAt, 'finishedAt'),
    error: value.error === null || typeof value.error === 'string' ? value.error : null,
    latestRun: parseRunSummary(value.latestRun),
  };
}

export function parseCollectorJobList(value: unknown): Paginated<CollectorJob> {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new MonitorContractError('invalid_body', '采集任务列表响应不完整');
  }
  if (
    typeof value.page !== 'number' ||
    typeof value.pageSize !== 'number' ||
    typeof value.totalItems !== 'number' ||
    typeof value.totalPages !== 'number'
  ) {
    throw new MonitorContractError('invalid_body', '采集任务列表响应不完整');
  }
  return {
    page: value.page,
    pageSize: value.pageSize,
    totalItems: value.totalItems,
    totalPages: value.totalPages,
    items: value.items.map((item) => parseCollectorJob(item)),
  };
}

export function parseMonitorTargetCreateResponse(value: unknown): MonitorTargetCreateResponse {
  if (!isRecord(value) || typeof value.created !== 'boolean' || typeof value.message !== 'string') {
    throw new MonitorContractError('invalid_body', '添加监控项响应不完整');
  }
  if (value.code !== 'created' && value.code !== 'target_exists') {
    throw new MonitorContractError('invalid_body', '添加监控项响应不完整');
  }
  return {
    target: parseMonitorTarget(value.target),
    created: value.created,
    code: value.code,
    message: value.message,
  };
}

export function parseMonitorTargetRunResponse(value: unknown): MonitorTargetRunResponse {
  if (!isRecord(value) || typeof value.created !== 'boolean' || typeof value.message !== 'string') {
    throw new MonitorContractError('invalid_body', '立即采集响应不完整');
  }
  return {
    job: parseCollectorJob(value.job),
    created: value.created,
    message: value.message,
  };
}

export function parseMonitorListQuery(
  pageRaw: string | undefined,
  pageSizeRaw: string | undefined,
): {
  page: number;
  pageSize: number;
} {
  try {
    return {
      page: parseMonitorPage(pageRaw),
      pageSize: parseMonitorPageSize(pageSizeRaw),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid page';
    if (message.includes('pageSize')) {
      throw new MonitorContractError('invalid_page', '每页条数不正确');
    }
    throw new MonitorContractError('invalid_page', '页码不正确');
  }
}

export function splitTagInput(raw: string): string[] {
  return raw
    .split(/[,，\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
