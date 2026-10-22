import { parseMonitorPage, parseMonitorPageSize, type Paginated } from './monitor';

export const MONITOR_TARGET_TYPES = ['video', 'creator', 'dynamic'] as const;
export type MonitorTargetType = (typeof MONITOR_TARGET_TYPES)[number];

export const MONITOR_INTERVAL_MINUTES = [5, 15, 30, 60, 180, 360, 720, 1440] as const;
export type MonitorIntervalMinutes = (typeof MONITOR_INTERVAL_MINUTES)[number];

/** Stored frequency. The preset list above stays for existing UI callers. */
export const MIN_MONITOR_INTERVAL_MINUTES = 5;
export const MAX_MONITOR_INTERVAL_MINUTES = 10_080;
export const CREATOR_DEFAULT_INTERVAL_MINUTES = 240;
/** Fixed interval used when a dynamic target omits intervalMinutes. Not an age policy. */
export const DYNAMIC_DEFAULT_INTERVAL_MINUTES = 60;

export const MONITOR_INTERVAL_MODES = ['auto', 'fixed'] as const;
export type MonitorIntervalMode = (typeof MONITOR_INTERVAL_MODES)[number];

export const COLLECTOR_JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;
export type CollectorJobStatus = (typeof COLLECTOR_JOB_STATUSES)[number];

export const COLLECTOR_RUN_STATUSES = ['succeeded', 'failed'] as const;
export type CollectorRunStatus = (typeof COLLECTOR_RUN_STATUSES)[number];

const VIDEO_EXTERNAL_ID = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
const CREATOR_EXTERNAL_ID = /^[1-9][0-9]{0,18}$/;
const DYNAMIC_EXTERNAL_ID = /^[1-9]\d*$/;
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
  intervalMode: MonitorIntervalMode;
  /** User-planned first collect instant (video only). Null = immediate / no plan. */
  startAt: string | null;
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
  /**
   * Runtime range is 5–10080. The preset union is kept so the existing web
   * caller, which annotates this field as MonitorIntervalMinutes, still typechecks.
   */
  intervalMinutes: MonitorIntervalMinutes;
  intervalMode: MonitorIntervalMode;
  /** Video only. Omitted/null = immediate. Must carry an explicit timezone. */
  startAt?: string | null;
};

export type MonitorTargetPatchRequest = {
  enabled?: boolean;
  intervalMinutes?: number;
  intervalMode?: MonitorIntervalMode;
  tags?: string[];
  label?: string;
  /**
   * Video pending-start reschedule only. Omitted = unchanged; explicit null
   * clears the plan and treats the target as immediately due.
   */
  startAt?: string | null;
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

export function isMonitorTargetType(value: unknown): value is MonitorTargetType {
  return value === 'video' || value === 'creator' || value === 'dynamic';
}

export function externalIdError(type: MonitorTargetType, externalId: string): string | null {
  if (type === 'video') {
    return VIDEO_EXTERNAL_ID.test(externalId) ? null : 'BV 号格式不正确';
  }
  if (type === 'dynamic') {
    return DYNAMIC_EXTERNAL_ID.test(externalId) ? null : '动态 id 必须是十进制整数字符串';
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

function parseIntervalMode(value: unknown, fallback: MonitorIntervalMode): MonitorIntervalMode {
  if (value === undefined || value === null) return fallback;
  if (value !== 'auto' && value !== 'fixed') {
    throw new MonitorContractError('invalid_interval', '采集模式只能是自动或固定');
  }
  return value;
}

/** Dynamics stay on a fixed interval. Omitted mode means fixed, not the video age policy. */
function parseDynamicIntervalMode(value: unknown): 'fixed' {
  if (value === undefined || value === null) return 'fixed';
  if (value === 'auto') {
    throw new MonitorContractError('invalid_interval', '动态只支持固定间隔，不能使用自动频率');
  }
  if (value !== 'fixed') {
    throw new MonitorContractError('invalid_interval', '采集模式只能是自动或固定');
  }
  return 'fixed';
}

function externalIdTypeMessage(type: MonitorTargetType): string {
  if (type === 'video') return 'BV 号格式不正确';
  if (type === 'dynamic') return '动态 id 必须是十进制整数字符串';
  return 'UID 格式不正确';
}

function parseStoredInterval(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_MONITOR_INTERVAL_MINUTES ||
    value > MAX_MONITOR_INTERVAL_MINUTES
  ) {
    throw new MonitorContractError('invalid_interval', '采集频率不在允许范围内');
  }
  return value;
}

/** Preset alias for callers that still annotate the create payload with the old union. */
function asPresetInterval(value: number): MonitorIntervalMinutes {
  return value as MonitorIntervalMinutes;
}

export function parseCreateMonitorTargetRequest(value: unknown): MonitorTargetCreateRequest {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '请求体不是合法的监控项');
  }
  rejectUnknownKeys(value, [
    'type',
    'externalId',
    'label',
    'tags',
    'intervalMinutes',
    'intervalMode',
    'startAt',
  ]);
  if (!isMonitorTargetType(value.type)) {
    throw new MonitorContractError('invalid_target_type', '监控类型只能是视频、UP 主或动态');
  }
  if (typeof value.externalId !== 'string') {
    throw new MonitorContractError('invalid_external_id', externalIdTypeMessage(value.type));
  }
  const externalId = value.externalId.trim();
  const idError = externalIdError(value.type, externalId);
  if (idError) throw new MonitorContractError('invalid_external_id', idError);
  const intervalMode =
    value.type === 'dynamic'
      ? parseDynamicIntervalMode(value.intervalMode)
      : parseIntervalMode(value.intervalMode, 'auto');
  const startAt = parseOptionalStartAtField(value.startAt, value.type);
  const request: MonitorTargetCreateRequest = {
    type: value.type,
    externalId,
    label: parseLabel(value.label, externalId),
    tags: parseTags(value.tags),
    intervalMode,
    intervalMinutes: asPresetInterval(
      parseStoredInterval(
        value.intervalMinutes,
        value.type === 'creator'
          ? CREATOR_DEFAULT_INTERVAL_MINUTES
          : DYNAMIC_DEFAULT_INTERVAL_MINUTES,
      ),
    ),
  };
  if (startAt !== undefined) request.startAt = startAt;
  return request;
}

/**
 * Wire body for create. Automatic mode omits intervalMinutes so the client
 * does not pin the legacy 60-minute preset over the collector age policy.
 * Fixed mode always sends the chosen interval.
 */
export function serializeCreateMonitorTargetRequest(request: MonitorTargetCreateRequest): {
  type: MonitorTargetType;
  externalId: string;
  label: string;
  tags: string[];
  intervalMode: MonitorIntervalMode;
  intervalMinutes?: number;
  startAt?: string | null;
} {
  const body: {
    type: MonitorTargetType;
    externalId: string;
    label: string;
    tags: string[];
    intervalMode: MonitorIntervalMode;
    intervalMinutes?: number;
    startAt?: string | null;
  } = {
    type: request.type,
    externalId: request.externalId,
    label: request.label,
    tags: request.tags,
    intervalMode: request.intervalMode,
  };
  if (request.intervalMode === 'fixed') body.intervalMinutes = request.intervalMinutes;
  if (request.startAt !== undefined) body.startAt = request.startAt;
  return body;
}

export function parsePatchMonitorTargetRequest(value: unknown): MonitorTargetPatchRequest {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '请求体不是合法的监控项更新');
  }
  rejectUnknownKeys(value, [
    'enabled',
    'intervalMinutes',
    'intervalMode',
    'tags',
    'label',
    'startAt',
  ]);
  const patch: MonitorTargetPatchRequest = {};
  if ('enabled' in value) {
    if (typeof value.enabled !== 'boolean') {
      throw new MonitorContractError('invalid_body', '启用状态必须是布尔值');
    }
    patch.enabled = value.enabled;
  }
  if ('intervalMinutes' in value) {
    if (value.intervalMinutes === undefined || value.intervalMinutes === null) {
      throw new MonitorContractError('invalid_interval', '采集频率不在允许范围内');
    }
    patch.intervalMinutes = parseStoredInterval(value.intervalMinutes, 0);
  }
  if ('intervalMode' in value) {
    if (value.intervalMode === undefined || value.intervalMode === null) {
      throw new MonitorContractError('invalid_interval', '采集模式只能是自动或固定');
    }
    patch.intervalMode = parseIntervalMode(value.intervalMode, 'auto');
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
  if ('startAt' in value) {
    patch.startAt = parseMonitorStartAtInput(value.startAt);
  }
  if (
    patch.enabled === undefined &&
    patch.intervalMinutes === undefined &&
    patch.intervalMode === undefined &&
    patch.tags === undefined &&
    patch.label === undefined &&
    patch.startAt === undefined
  ) {
    throw new MonitorContractError('invalid_patch', '没有可更新的字段');
  }
  return patch;
}

/**
 * Accept only full instants with an explicit timezone (Z or ±HH:MM).
 * Bare local forms like 2026-10-21T12:00:00 are rejected so servers and
 * browsers cannot silently reinterpret Asia/Shanghai business times.
 * Civil Y-M-D must be a real calendar date (no Date.parse rollover of Feb 30).
 */
const START_AT_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function assertCivilDate(year: number, month: number, day: number): void {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new MonitorContractError('invalid_start_at', '开始时间不是合法日历日期');
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new MonitorContractError('invalid_start_at', '开始时间不是合法日历日期');
  }
}

function assertCivilTime(hour: number, minute: number, second: number): void {
  if (hour > 23 || minute > 59 || second > 59) {
    throw new MonitorContractError('invalid_start_at', '开始时间不是合法时间');
  }
}

export function parseMonitorStartAtInput(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new MonitorContractError('invalid_start_at', '开始时间必须是带时区的完整时间');
  }
  const raw = value.trim();
  const matched = START_AT_WITH_ZONE.exec(raw);
  if (!matched) {
    throw new MonitorContractError(
      'invalid_start_at',
      '开始时间必须是带明确时区的完整时间（例如 2026-10-21T20:00:00+08:00）',
    );
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const second = Number(matched[6]);
  assertCivilDate(year, month, day);
  assertCivilTime(hour, minute, second);
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new MonitorContractError('invalid_start_at', '开始时间不是合法时间');
  }
  return new Date(ms).toISOString();
}

function parseOptionalStartAtField(
  value: unknown,
  type: MonitorTargetType,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (type !== 'video' && value !== null) {
    throw new MonitorContractError('invalid_start_at', '只有视频监控支持计划开始时间');
  }
  return parseMonitorStartAtInput(value);
}

/** Response field: missing startAt on old payloads is null, not an error. */
function parseOptionalStartAtResponse(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new MonitorContractError('invalid_body', 'startAt 不是合法时间');
  }
  return value;
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
  if (!isMonitorTargetType(value.type)) {
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
  const intervalMode = value.intervalMode === undefined ? 'auto' : value.intervalMode;
  if (intervalMode !== 'auto' && intervalMode !== 'fixed') {
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
    intervalMode,
    startAt: parseOptionalStartAtResponse(value.startAt),
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
  if (!isMonitorTargetType(value.targetType)) {
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

/** First-collect inaccessible wait vs manual-intervention handoff (WP-R2-17A2). */
export const FIRST_ACCESS_INTERVENTION_STATUSES = [
  'waiting_confirmation',
  'awaiting_manual',
] as const;
export type FirstAccessInterventionStatus = (typeof FIRST_ACCESS_INTERVENTION_STATUSES)[number];

export type FirstAccessIntervention = {
  /** Stable round id = collector_jobs.id for this bounded attempt series. */
  id: string;
  targetId: string;
  bvid: string;
  status: FirstAccessInterventionStatus;
  failureCount: number;
  reason: string;
  failedAt: string;
};

export type FirstAccessInterventionList = {
  items: FirstAccessIntervention[];
};

export function parseFirstAccessIntervention(value: unknown): FirstAccessIntervention {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '首次采集介入事项不完整');
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.targetId !== 'string' ||
    typeof value.bvid !== 'string' ||
    typeof value.reason !== 'string' ||
    typeof value.failedAt !== 'string' ||
    typeof value.failureCount !== 'number' ||
    !Number.isInteger(value.failureCount) ||
    value.failureCount < 1
  ) {
    throw new MonitorContractError('invalid_body', '首次采集介入事项不完整');
  }
  if (
    value.status !== 'waiting_confirmation' &&
    value.status !== 'awaiting_manual'
  ) {
    throw new MonitorContractError('invalid_body', '首次采集介入事项状态不正确');
  }
  return {
    id: value.id,
    targetId: value.targetId,
    bvid: value.bvid,
    status: value.status,
    failureCount: value.failureCount,
    reason: value.reason,
    failedAt: value.failedAt,
  };
}

export function parseFirstAccessInterventionList(value: unknown): FirstAccessInterventionList {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new MonitorContractError('invalid_body', '首次采集介入列表不完整');
  }
  return { items: value.items.map((item) => parseFirstAccessIntervention(item)) };
}
