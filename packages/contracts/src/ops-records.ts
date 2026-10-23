export const OPS_TIMEZONE = 'Asia/Shanghai' as const;
export const OPS_DEFAULT_DAY_SPAN = 7;
export const OPS_JOB_DEFAULT_PAGE_SIZE = 20;
export const OPS_JOB_MAX_PAGE_SIZE = 50;
export const OPS_GROUP_DEFAULT_JOBS = 5;
export const OPS_GROUP_MAX_JOBS = 10;
export const OPS_ATTEMPT_DEFAULT_PAGE_SIZE = 10;
export const OPS_ATTEMPT_MAX_PAGE_SIZE = 20;
export const OPS_TARGET_SEARCH_LIMIT = 20;
export const OPS_PROJECT_SEARCH_LIMIT = 20;

export const OPS_JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;
export type OpsJobStatus = (typeof OPS_JOB_STATUSES)[number];

export const OPS_RECORD_GROUPS = ['time', 'target'] as const;
export type OpsRecordGroup = (typeof OPS_RECORD_GROUPS)[number];

export const OPS_OPERATION_ACTIONS = [
  'create',
  'pause',
  'resume',
  'interval',
  'rename',
  'tags',
  'remove',
  'run',
  'reschedule',
] as const;
export type OpsOperationAction = (typeof OPS_OPERATION_ACTIONS)[number];

export const OPS_OPERATION_EVENTS = [
  'monitor.target.created',
  'monitor.target.paused',
  'monitor.target.resumed',
  'monitor.target.interval',
  'monitor.target.renamed',
  'monitor.target.tags',
  'monitor.target.removed',
  'monitor.target.run',
  'monitor.target.reschedule',
] as const;
export type OpsOperationEvent = (typeof OPS_OPERATION_EVENTS)[number];

export const OPS_LOG_NOTES = ['关联日志已过保留期', '暂无关联日志'] as const;
export type OpsLogNote = (typeof OPS_LOG_NOTES)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OpsAppliedRange = {
  since: string;
  until: string;
  timezone: typeof OPS_TIMEZONE;
  defaulted: boolean;
};

export type OpsLogRetention = {
  days: number;
  cutoff: string;
  oldestStoredAt: string | null;
  timezone: typeof OPS_TIMEZONE;
};

export type OpsProjectRef = {
  id: string;
  name: string;
};

export type OpsJobAttemptSummary = {
  id: string;
  status: 'succeeded' | 'failed';
  samplesWritten: number;
  durationMs: number;
  error: string | null;
  startedAt: string;
  finishedAt: string;
};

export type OpsCollectorJob = {
  id: string;
  targetId: string;
  targetType: 'video' | 'creator' | 'dynamic' | 'discovery';
  externalId: string;
  label: string;
  displayName: string;
  coverUrl: string | null;
  targetDeleted: boolean;
  status: OpsJobStatus;
  attempts: number;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  samplesWritten: number | null;
  error: string | null;
  latestAttempt: OpsJobAttemptSummary | null;
  projects: OpsProjectRef[];
};

export type OpsCollectorJobList = {
  mode: 'time';
  items: OpsCollectorJob[];
  total: number;
  page: number;
  pageSize: number;
  range: OpsAppliedRange;
  logRetention: OpsLogRetention;
};

export type OpsCollectorJobGroup = {
  targetId: string;
  targetType: 'video' | 'creator' | 'dynamic' | 'discovery';
  externalId: string;
  label: string;
  displayName: string;
  coverUrl: string | null;
  targetDeleted: boolean;
  matchCount: number;
  truncated: boolean;
  jobs: OpsCollectorJob[];
};

export type OpsCollectorJobGroups = {
  mode: 'target';
  items: OpsCollectorJobGroup[];
  total: number;
  page: number;
  pageSize: number;
  jobsPerGroup: number;
  range: OpsAppliedRange;
  logRetention: OpsLogRetention;
};

export type OpsCollectorAttempt = {
  id: string;
  status: 'succeeded' | 'failed';
  samplesWritten: number;
  durationMs: number;
  error: string | null;
  startedAt: string;
  finishedAt: string;
  requests: {
    id: string;
    endpoint: string;
    statusCode: number | null;
    bizCode: number | null;
    durationMs: number;
    error: string | null;
    requestedAt: string;
    runId: string | null;
  }[];
  requestsTruncated: boolean;
  logs: OpsRecordLog[];
  logsTruncated: boolean;
  logNote: OpsLogNote | null;
};

export type OpsRecordLog = {
  id: string;
  ts: string;
  level: string;
  service: string;
  event: string | null;
  message: string;
  requestId: string | null;
  runId: string | null;
  context: Record<string, unknown>;
};

export type OpsCollectorJobDetail = {
  job: OpsCollectorJob;
  attempts: OpsCollectorAttempt[];
  attemptTotal: number;
  attemptPage: number;
  attemptPageSize: number;
  jobLogs: OpsRecordLog[];
  jobLogsTruncated: boolean;
  logRetention: OpsLogRetention;
};

export type OpsCollectorTargetOption = {
  id: string;
  type: 'video' | 'creator' | 'dynamic' | 'discovery';
  externalId: string;
  label: string;
  displayName: string;
  deleted: boolean;
};

export type OpsCollectorTargetSearch = {
  items: OpsCollectorTargetOption[];
  limit: number;
};

export type OpsProjectOption = {
  id: string;
  name: string;
};

export type OpsProjectSearch = {
  items: OpsProjectOption[];
  limit: number;
};

export type OpsOperationChange = {
  before: string | number | boolean | string[] | null;
  after: string | number | boolean | string[] | null;
};

export type OpsOperation = {
  id: string;
  ts: string;
  action: OpsOperationAction;
  event: OpsOperationEvent;
  targetId: string | null;
  targetType: 'video' | 'creator' | 'dynamic' | 'discovery' | null;
  externalId: string | null;
  label: string | null;
  actor: string | null;
  source: string | null;
  requestId: string | null;
  changes: Record<string, OpsOperationChange>;
};

export type OpsOperationList = {
  items: OpsOperation[];
  total: number;
  page: number;
  pageSize: number;
  range: OpsAppliedRange;
};

export type OpsCollectorJobQuery = {
  type: 'video' | 'creator' | 'dynamic' | 'discovery' | null;
  targetId: string | null;
  externalId: string | null;
  q: string | null;
  status: OpsJobStatus | null;
  since: string | null;
  until: string | null;
  projectId: string | null;
  group: OpsRecordGroup;
  page: number;
  pageSize: number;
  jobsPerGroup: number;
};

export function formatShanghaiDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: OPS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('invalid shanghai day');
  return `${year}-${month}-${day}`;
}

export function shiftShanghaiDay(day: string, delta: number): string {
  const parsed = parseDay(day, 'day');
  const [year, month, date] = parsed.split('-').map((part) => Number(part));
  const utc = new Date(Date.UTC(year!, month! - 1, date!, 4, 0, 0));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return formatShanghaiDay(utc);
}

export function opsDefaultRange(now = new Date()): { since: string; until: string } {
  const until = formatShanghaiDay(now);
  return { since: shiftShanghaiDay(until, -(OPS_DEFAULT_DAY_SPAN - 1)), until };
}

export function resolveOpsRange(
  since: string | null,
  until: string | null,
  now = new Date(),
): OpsAppliedRange {
  const fallback = opsDefaultRange(now);
  const resolvedSince = since === null ? fallback.since : parseDay(since, 'since');
  const resolvedUntil = until === null ? fallback.until : parseDay(until, 'until');
  if (resolvedSince > resolvedUntil) throw new Error('invalid range');
  return {
    since: resolvedSince,
    until: resolvedUntil,
    timezone: OPS_TIMEZONE,
    defaulted: since === null || until === null,
  };
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a string`);
  return value;
}

function asNullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  return asString(value, name);
}

function asIso(value: unknown, name: string): string {
  const text = asString(value, name);
  if (Number.isNaN(Date.parse(text))) throw new Error(`${name} must be an ISO date`);
  return text;
}

function asNullableIso(value: unknown, name: string): string | null {
  if (value === null) return null;
  return asIso(value, name);
}

function asCount(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function asNullableCount(value: unknown, name: string): number | null {
  if (value === null) return null;
  return asCount(value, name);
}

function asInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

function parseDay(raw: string, name: string): string {
  if (!DAY.test(raw)) throw new Error(`invalid ${name}`);
  const [year, month, date] = raw.split('-').map((part) => Number(part));
  const utc = new Date(Date.UTC(year!, month! - 1, date!));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month! - 1 ||
    utc.getUTCDate() !== date
  ) {
    throw new Error(`invalid ${name}`);
  }
  return raw;
}

function parseOptionalDay(raw: string | undefined, name: string): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  return parseDay(raw.trim(), name);
}

function parsePositive(
  raw: string | undefined,
  name: string,
  fallback: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`invalid ${name}`);
  const value = Number(raw.trim());
  if (value < 1 || value > 10000) throw new Error(`invalid ${name}`);
  return Math.min(value, max);
}

function parseUuid(raw: string | undefined, name: string): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  if (!UUID.test(raw.trim())) throw new Error(`invalid ${name}`);
  return raw.trim();
}

function parseSearch(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  return raw.trim().slice(0, 200);
}

export function parseOpsCollectorJobQuery(input: {
  type?: string | undefined;
  targetId?: string | undefined;
  externalId?: string | undefined;
  q?: string | undefined;
  status?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  projectId?: string | undefined;
  group?: string | undefined;
  page?: string | undefined;
  pageSize?: string | undefined;
  jobsPerGroup?: string | undefined;
}): OpsCollectorJobQuery {
  const type = input.type?.trim() ?? '';
  if (
    type !== '' &&
    type !== 'all' &&
    type !== 'video' &&
    type !== 'creator' &&
    type !== 'dynamic'
  ) {
    throw new Error('invalid type');
  }
  const status = input.status?.trim() ?? '';
  if (status !== '' && status !== 'all' && !OPS_JOB_STATUSES.includes(status as OpsJobStatus)) {
    throw new Error('invalid status');
  }
  const group = input.group?.trim() || 'time';
  if (!OPS_RECORD_GROUPS.includes(group as OpsRecordGroup)) throw new Error('invalid group');
  return {
    type:
      type === '' || type === 'all'
        ? null
        : (type as 'video' | 'creator' | 'dynamic' | 'discovery'),
    targetId: parseUuid(input.targetId, 'targetId'),
    externalId: parseSearch(input.externalId),
    q: parseSearch(input.q),
    status: status === '' || status === 'all' ? null : (status as OpsJobStatus),
    since: parseOptionalDay(input.since, 'since'),
    until: parseOptionalDay(input.until, 'until'),
    projectId: parseUuid(input.projectId, 'projectId'),
    group: group as OpsRecordGroup,
    page: parsePositive(input.page, 'page', 1, 10000),
    pageSize: parsePositive(
      input.pageSize,
      'pageSize',
      OPS_JOB_DEFAULT_PAGE_SIZE,
      OPS_JOB_MAX_PAGE_SIZE,
    ),
    jobsPerGroup: parsePositive(
      input.jobsPerGroup,
      'jobsPerGroup',
      OPS_GROUP_DEFAULT_JOBS,
      OPS_GROUP_MAX_JOBS,
    ),
  };
}

function parseRange(value: unknown): OpsAppliedRange {
  const row = asObject(value, 'range');
  if (row.timezone !== OPS_TIMEZONE) throw new Error('range timezone is invalid');
  return {
    since: parseDay(asString(row.since, 'since'), 'since'),
    until: parseDay(asString(row.until, 'until'), 'until'),
    timezone: OPS_TIMEZONE,
    defaulted: asBoolean(row.defaulted, 'defaulted'),
  };
}

function parseRetention(value: unknown): OpsLogRetention {
  const row = asObject(value, 'logRetention');
  if (row.timezone !== OPS_TIMEZONE) throw new Error('logRetention timezone is invalid');
  return {
    days: asCount(row.days, 'days'),
    cutoff: asIso(row.cutoff, 'cutoff'),
    oldestStoredAt: asNullableIso(row.oldestStoredAt, 'oldestStoredAt'),
    timezone: OPS_TIMEZONE,
  };
}

function parseProjects(value: unknown): OpsProjectRef[] {
  if (!Array.isArray(value)) throw new Error('projects must be an array');
  return value.map((item) => {
    const row = asObject(item, 'project');
    return { id: asString(row.id, 'id'), name: typeof row.name === 'string' ? row.name : '' };
  });
}

function parseAttemptSummary(value: unknown): OpsJobAttemptSummary | null {
  if (value === null) return null;
  const row = asObject(value, 'latestAttempt');
  const status = row.status;
  if (status !== 'succeeded' && status !== 'failed') throw new Error('attempt status is invalid');
  return {
    id: asString(row.id, 'id'),
    status,
    samplesWritten: asCount(row.samplesWritten, 'samplesWritten'),
    durationMs: asCount(row.durationMs, 'durationMs'),
    error: asNullableString(row.error, 'error'),
    startedAt: asIso(row.startedAt, 'startedAt'),
    finishedAt: asIso(row.finishedAt, 'finishedAt'),
  };
}

export function parseOpsCollectorJob(value: unknown): OpsCollectorJob {
  const row = asObject(value, 'job');
  const targetType = row.targetType;
  if (
    targetType !== 'video' &&
    targetType !== 'creator' &&
    targetType !== 'dynamic' &&
    targetType !== 'discovery'
  )
    throw new Error('target type is invalid');
  const status = row.status;
  if (typeof status !== 'string' || !OPS_JOB_STATUSES.includes(status as OpsJobStatus)) {
    throw new Error('job status is invalid');
  }
  return {
    id: asString(row.id, 'id'),
    targetId: asString(row.targetId, 'targetId'),
    targetType,
    externalId: asString(row.externalId, 'externalId'),
    label: typeof row.label === 'string' ? row.label : '',
    displayName: typeof row.displayName === 'string' ? row.displayName : '',
    coverUrl: asNullableString(row.coverUrl, 'coverUrl'),
    targetDeleted: asBoolean(row.targetDeleted, 'targetDeleted'),
    status: status as OpsJobStatus,
    attempts: asCount(row.attempts, 'attempts'),
    scheduledFor: asIso(row.scheduledFor, 'scheduledFor'),
    startedAt: asNullableIso(row.startedAt, 'startedAt'),
    finishedAt: asNullableIso(row.finishedAt, 'finishedAt'),
    durationMs: asNullableCount(row.durationMs, 'durationMs'),
    samplesWritten: asNullableCount(row.samplesWritten, 'samplesWritten'),
    error: asNullableString(row.error, 'error'),
    latestAttempt: parseAttemptSummary(row.latestAttempt),
    projects: parseProjects(row.projects),
  };
}

export function parseOpsCollectorJobList(value: unknown): OpsCollectorJobList {
  const row = asObject(value, 'jobs');
  if (row.mode !== 'time') throw new Error('jobs mode is invalid');
  if (!Array.isArray(row.items)) throw new Error('jobs items must be an array');
  return {
    mode: 'time',
    items: row.items.map((item) => parseOpsCollectorJob(item)),
    total: asCount(row.total, 'total'),
    page: asCount(row.page, 'page'),
    pageSize: asCount(row.pageSize, 'pageSize'),
    range: parseRange(row.range),
    logRetention: parseRetention(row.logRetention),
  };
}

export function parseOpsCollectorJobGroups(value: unknown): OpsCollectorJobGroups {
  const row = asObject(value, 'groups');
  if (row.mode !== 'target') throw new Error('groups mode is invalid');
  if (!Array.isArray(row.items)) throw new Error('groups items must be an array');
  return {
    mode: 'target',
    items: row.items.map((item) => {
      const group = asObject(item, 'group');
      const targetType = group.targetType;
      if (
        targetType !== 'video' &&
        targetType !== 'creator' &&
        targetType !== 'dynamic' &&
        targetType !== 'discovery'
      ) {
        throw new Error('target type is invalid');
      }
      if (!Array.isArray(group.jobs)) throw new Error('group jobs must be an array');
      return {
        targetId: asString(group.targetId, 'targetId'),
        targetType,
        externalId: asString(group.externalId, 'externalId'),
        label: typeof group.label === 'string' ? group.label : '',
        displayName: typeof group.displayName === 'string' ? group.displayName : '',
        coverUrl: asNullableString(group.coverUrl, 'coverUrl'),
        targetDeleted: asBoolean(group.targetDeleted, 'targetDeleted'),
        matchCount: asCount(group.matchCount, 'matchCount'),
        truncated: asBoolean(group.truncated, 'truncated'),
        jobs: group.jobs.map((job) => parseOpsCollectorJob(job)),
      };
    }),
    total: asCount(row.total, 'total'),
    page: asCount(row.page, 'page'),
    pageSize: asCount(row.pageSize, 'pageSize'),
    jobsPerGroup: asCount(row.jobsPerGroup, 'jobsPerGroup'),
    range: parseRange(row.range),
    logRetention: parseRetention(row.logRetention),
  };
}

function parseRecordLog(value: unknown): OpsRecordLog {
  const row = asObject(value, 'log');
  const context = row.context;
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw new Error('context must be an object');
  }
  return {
    id: asString(row.id, 'id'),
    ts: asIso(row.ts, 'ts'),
    level: asString(row.level, 'level'),
    service: asString(row.service, 'service'),
    event: asNullableString(row.event, 'event'),
    message: typeof row.message === 'string' ? row.message : '',
    requestId: asNullableString(row.requestId, 'requestId'),
    runId: asNullableString(row.runId, 'runId'),
    context: context as Record<string, unknown>,
  };
}

function parseAttemptRequest(value: unknown): OpsCollectorAttempt['requests'][number] {
  const row = asObject(value, 'request');
  return {
    id: asString(row.id, 'id'),
    endpoint: asString(row.endpoint, 'endpoint'),
    statusCode: row.statusCode === null ? null : asCount(row.statusCode, 'statusCode'),
    bizCode: row.bizCode === null ? null : asInt(row.bizCode, 'bizCode'),
    durationMs: asCount(row.durationMs, 'durationMs'),
    error: asNullableString(row.error, 'error'),
    requestedAt: asIso(row.requestedAt, 'requestedAt'),
    runId: asNullableString(row.runId, 'runId'),
  };
}

export function parseOpsCollectorJobDetail(value: unknown): OpsCollectorJobDetail {
  const row = asObject(value, 'job detail');
  if (!Array.isArray(row.attempts) || !Array.isArray(row.jobLogs)) {
    throw new Error('job detail lists must be arrays');
  }
  return {
    job: parseOpsCollectorJob(row.job),
    attempts: row.attempts.map((item) => {
      const attempt = asObject(item, 'attempt');
      const status = attempt.status;
      if (status !== 'succeeded' && status !== 'failed')
        throw new Error('attempt status is invalid');
      if (!Array.isArray(attempt.requests) || !Array.isArray(attempt.logs)) {
        throw new Error('attempt lists must be arrays');
      }
      const logNote = attempt.logNote;
      if (logNote !== null && logNote !== '关联日志已过保留期' && logNote !== '暂无关联日志') {
        throw new Error('log note is invalid');
      }
      return {
        id: asString(attempt.id, 'id'),
        status,
        samplesWritten: asCount(attempt.samplesWritten, 'samplesWritten'),
        durationMs: asCount(attempt.durationMs, 'durationMs'),
        error: asNullableString(attempt.error, 'error'),
        startedAt: asIso(attempt.startedAt, 'startedAt'),
        finishedAt: asIso(attempt.finishedAt, 'finishedAt'),
        requests: attempt.requests.map((request) => parseAttemptRequest(request)),
        requestsTruncated: asBoolean(attempt.requestsTruncated, 'requestsTruncated'),
        logs: attempt.logs.map((log) => parseRecordLog(log)),
        logsTruncated: asBoolean(attempt.logsTruncated, 'logsTruncated'),
        logNote,
      };
    }),
    attemptTotal: asCount(row.attemptTotal, 'attemptTotal'),
    attemptPage: asCount(row.attemptPage, 'attemptPage'),
    attemptPageSize: asCount(row.attemptPageSize, 'attemptPageSize'),
    jobLogs: row.jobLogs.map((log) => parseRecordLog(log)),
    jobLogsTruncated: asBoolean(row.jobLogsTruncated, 'jobLogsTruncated'),
    logRetention: parseRetention(row.logRetention),
  };
}

export function parseOpsCollectorTargetSearch(value: unknown): OpsCollectorTargetSearch {
  const row = asObject(value, 'targets');
  if (!Array.isArray(row.items)) throw new Error('targets items must be an array');
  return {
    items: row.items.map((item) => {
      const target = asObject(item, 'target');
      const type = target.type;
      if (type !== 'video' && type !== 'creator' && type !== 'dynamic' && type !== 'discovery') {
        throw new Error('target type is invalid');
      }
      return {
        id: asString(target.id, 'id'),
        type,
        externalId: asString(target.externalId, 'externalId'),
        label: typeof target.label === 'string' ? target.label : '',
        displayName: typeof target.displayName === 'string' ? target.displayName : '',
        deleted: asBoolean(target.deleted, 'deleted'),
      };
    }),
    limit: asCount(row.limit, 'limit'),
  };
}

export function parseOpsProjectSearch(value: unknown): OpsProjectSearch {
  const row = asObject(value, 'projects');
  if (!Array.isArray(row.items)) throw new Error('projects items must be an array');
  return {
    items: row.items.map((item) => {
      const project = asObject(item, 'project');
      return {
        id: asString(project.id, 'id'),
        name: typeof project.name === 'string' ? project.name : '',
      };
    }),
    limit: asCount(row.limit, 'limit'),
  };
}

const ACTION_BY_EVENT: Record<OpsOperationEvent, OpsOperationAction> = {
  'monitor.target.created': 'create',
  'monitor.target.paused': 'pause',
  'monitor.target.resumed': 'resume',
  'monitor.target.interval': 'interval',
  'monitor.target.renamed': 'rename',
  'monitor.target.tags': 'tags',
  'monitor.target.removed': 'remove',
  'monitor.target.run': 'run',
  'monitor.target.reschedule': 'reschedule',
};

function parseChangeValue(value: unknown): OpsOperationChange['before'] {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  throw new Error('change value is invalid');
}

export function parseOpsOperation(value: unknown): OpsOperation {
  const row = asObject(value, 'operation');
  const event = row.event;
  if (typeof event !== 'string' || !OPS_OPERATION_EVENTS.includes(event as OpsOperationEvent)) {
    throw new Error('operation event is invalid');
  }
  const action = ACTION_BY_EVENT[event as OpsOperationEvent];
  if (row.action !== action) {
    throw new Error('operation action is invalid');
  }
  const targetType = row.targetType;
  if (
    targetType !== null &&
    targetType !== 'video' &&
    targetType !== 'creator' &&
    targetType !== 'dynamic' &&
    targetType !== 'discovery'
  ) {
    throw new Error('target type is invalid');
  }
  const changes = asObject(row.changes, 'changes');
  const parsedChanges: Record<string, OpsOperationChange> = {};
  for (const [key, change] of Object.entries(changes)) {
    const item = asObject(change, key);
    parsedChanges[key] = {
      before: parseChangeValue(item.before),
      after: parseChangeValue(item.after),
    };
  }
  return {
    id: asString(row.id, 'id'),
    ts: asIso(row.ts, 'ts'),
    action,
    event: event as OpsOperationEvent,
    targetId: asNullableString(row.targetId, 'targetId'),
    targetType,
    externalId: asNullableString(row.externalId, 'externalId'),
    label: row.label === null ? null : typeof row.label === 'string' ? row.label : '',
    actor: asNullableString(row.actor, 'actor'),
    source: asNullableString(row.source, 'source'),
    requestId: asNullableString(row.requestId, 'requestId'),
    changes: parsedChanges,
  };
}

export function parseOpsOperationList(value: unknown): OpsOperationList {
  const row = asObject(value, 'operations');
  if (!Array.isArray(row.items)) throw new Error('operations items must be an array');
  return {
    items: row.items.map((item) => parseOpsOperation(item)),
    total: asCount(row.total, 'total'),
    page: asCount(row.page, 'page'),
    pageSize: asCount(row.pageSize, 'pageSize'),
    range: parseRange(row.range),
  };
}

export function operationActionForEvent(event: string): OpsOperationAction | null {
  if (!OPS_OPERATION_EVENTS.includes(event as OpsOperationEvent)) return null;
  return ACTION_BY_EVENT[event as OpsOperationEvent];
}
