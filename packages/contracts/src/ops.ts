export const OPS_DEFAULT_LIMIT = 50;
export const OPS_MAX_LIMIT = 200;
export const OPS_SCHEMA_VERSION = '007_metadata_assets_logs';

export type OpsHeartbeatStatus = 'starting' | 'idle' | 'running' | 'stopped';

export type OpsHeartbeat = {
  instance: string;
  status: OpsHeartbeatStatus;
  lastSeenAt: string;
  currentJobId: string | null;
};

export type OpsQueue = {
  due: number;
  running: number;
  failed24h: number;
};

export type OpsCircuit = {
  accountId: string;
  openedAt: string;
  resumeAt: string;
  consecutiveFailures: number;
  reason: string;
};

export type OpsTargetStatus = {
  targetId: string;
  label: string;
  type: 'video' | 'creator';
  lastSuccessAt: string | null;
  lastError: string | null;
};

export type OpsSummary = {
  heartbeats: OpsHeartbeat[];
  queue: OpsQueue;
  circuits: OpsCircuit[];
  targets: OpsTargetStatus[];
  samplesToday: { videos: number; creators: number };
  recentErrorCount: number;
};

export type OpsRunStatus = 'succeeded' | 'failed';

export type OpsRun = {
  id: string;
  targetId: string;
  targetLabel: string;
  status: OpsRunStatus;
  samplesWritten: number;
  durationMs: number;
  error: string | null;
  startedAt: string;
  finishedAt: string;
};

export type OpsRequest = {
  id: string;
  endpoint: string;
  statusCode: number | null;
  bizCode: number | null;
  durationMs: number;
  error: string | null;
  requestedAt: string;
  runId: string | null;
};

export type OpsLog = {
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

export type OpsPage<T> = {
  items: T[];
  nextCursor: string | null;
  limit: number;
};

export type OpsRunDetail = {
  run: OpsRun;
  requests: OpsRequest[];
  logs: OpsLog[];
};

export type OpsHealth = {
  lastHeartbeatAt: string | null;
  stale: boolean;
  queueBacklog: number;
  lastSuccessAt: string | null;
};

export type OpsDebugTarget = {
  id: string;
  type: string;
  externalId: string;
  label: string;
  enabled: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
};

export type OpsDebugVideo = {
  bvid: string;
  title: string | null;
  description: string | null;
  durationSeconds: number | null;
  coverUrl: string | null;
  coverState: string;
  metadataState: string;
  metadataSource: string | null;
  metadataFetchedAt: string | null;
  metadataError: string | null;
  cid: string | null;
  pubdate: string | null;
  tid: number | null;
  tidV2: number | null;
  partitionName: string | null;
};

export type OpsDebugCreator = {
  mid: string;
  uname: string | null;
  faceUrl: string | null;
  metadataState: string;
  metadataSource: string | null;
  metadataFetchedAt: string | null;
  metadataError: string | null;
};

export type OpsDebugBundle = {
  schemaVersion: string;
  generatedAt: string;
  run: OpsRun | null;
  target: OpsDebugTarget | null;
  requests: OpsRequest[];
  logs: OpsLog[];
  video: OpsDebugVideo | null;
  creator: OpsDebugCreator | null;
  heartbeats: OpsHeartbeat[];
  circuits: OpsCircuit[];
};

const HEARTBEAT_STATUS = new Set<OpsHeartbeatStatus>(['starting', 'idle', 'running', 'stopped']);
const RUN_STATUS = new Set<OpsRunStatus>(['succeeded', 'failed']);

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

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

function asContext(value: unknown): Record<string, unknown> {
  return asObject(value, 'context');
}

export function parseOpsLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return OPS_DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw.trim())) throw new Error('invalid limit');
  const value = Number(raw.trim());
  if (value < 1) throw new Error('invalid limit');
  return Math.min(value, OPS_MAX_LIMIT);
}

export function encodeOpsCursor(payload: Record<string, string>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeOpsCursor(raw: string | undefined): Record<string, string> | null {
  if (raw === undefined || raw.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new Error('invalid cursor');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid cursor');
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') throw new Error('invalid cursor');
    out[key] = value;
  }
  return out;
}

export function parseOpsHeartbeat(value: unknown): OpsHeartbeat {
  const row = asObject(value, 'heartbeat');
  const status = row.status;
  if (typeof status !== 'string' || !HEARTBEAT_STATUS.has(status as OpsHeartbeatStatus)) {
    throw new Error('heartbeat status is invalid');
  }
  return {
    instance: asString(row.instance, 'instance'),
    status: status as OpsHeartbeatStatus,
    lastSeenAt: asIso(row.lastSeenAt, 'lastSeenAt'),
    currentJobId: asNullableString(row.currentJobId, 'currentJobId'),
  };
}

export function parseOpsCircuit(value: unknown): OpsCircuit {
  const row = asObject(value, 'circuit');
  return {
    accountId: asString(row.accountId, 'accountId'),
    openedAt: asIso(row.openedAt, 'openedAt'),
    resumeAt: asIso(row.resumeAt, 'resumeAt'),
    consecutiveFailures: asCount(row.consecutiveFailures, 'consecutiveFailures'),
    reason: asString(row.reason, 'reason'),
  };
}

export function parseOpsSummary(value: unknown): OpsSummary {
  const row = asObject(value, 'summary');
  const queue = asObject(row.queue, 'queue');
  const samples = asObject(row.samplesToday, 'samplesToday');
  if (
    !Array.isArray(row.heartbeats) ||
    !Array.isArray(row.circuits) ||
    !Array.isArray(row.targets)
  ) {
    throw new Error('summary lists must be arrays');
  }
  return {
    heartbeats: row.heartbeats.map((item) => parseOpsHeartbeat(item)),
    queue: {
      due: asCount(queue.due, 'due'),
      running: asCount(queue.running, 'running'),
      failed24h: asCount(queue.failed24h, 'failed24h'),
    },
    circuits: row.circuits.map((item) => parseOpsCircuit(item)),
    targets: row.targets.map((item) => {
      const target = asObject(item, 'target');
      const type = target.type;
      if (type !== 'video' && type !== 'creator') throw new Error('target type is invalid');
      return {
        targetId: asString(target.targetId, 'targetId'),
        label: typeof target.label === 'string' ? target.label : '',
        type,
        lastSuccessAt: asNullableIso(target.lastSuccessAt, 'lastSuccessAt'),
        lastError: asNullableString(target.lastError, 'lastError'),
      };
    }),
    samplesToday: {
      videos: asCount(samples.videos, 'videos'),
      creators: asCount(samples.creators, 'creators'),
    },
    recentErrorCount: asCount(row.recentErrorCount, 'recentErrorCount'),
  };
}

export function parseOpsRun(value: unknown): OpsRun {
  const row = asObject(value, 'run');
  const status = row.status;
  if (typeof status !== 'string' || !RUN_STATUS.has(status as OpsRunStatus)) {
    throw new Error('run status is invalid');
  }
  return {
    id: asString(row.id, 'id'),
    targetId: asString(row.targetId, 'targetId'),
    targetLabel: typeof row.targetLabel === 'string' ? row.targetLabel : '',
    status: status as OpsRunStatus,
    samplesWritten: asCount(row.samplesWritten, 'samplesWritten'),
    durationMs: asCount(row.durationMs, 'durationMs'),
    error: asNullableString(row.error, 'error'),
    startedAt: asIso(row.startedAt, 'startedAt'),
    finishedAt: asIso(row.finishedAt, 'finishedAt'),
  };
}

export function parseOpsRequest(value: unknown): OpsRequest {
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

function asInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new Error(`${name} must be an integer`);
  return value;
}

export function parseOpsLog(value: unknown): OpsLog {
  const row = asObject(value, 'log');
  return {
    id: asString(row.id, 'id'),
    ts: asIso(row.ts, 'ts'),
    level: asString(row.level, 'level'),
    service: asString(row.service, 'service'),
    event: asNullableString(row.event, 'event'),
    message: typeof row.message === 'string' ? row.message : '',
    requestId: asNullableString(row.requestId, 'requestId'),
    runId: asNullableString(row.runId, 'runId'),
    context: asContext(row.context),
  };
}

export function parseOpsPage<T>(
  value: unknown,
  parseItem: (item: unknown) => T,
  name: string,
): OpsPage<T> {
  const row = asObject(value, name);
  if (!Array.isArray(row.items)) throw new Error(`${name} items must be an array`);
  return {
    items: row.items.map((item) => parseItem(item)),
    nextCursor: asNullableString(row.nextCursor, 'nextCursor'),
    limit: asCount(row.limit, 'limit'),
  };
}

export function parseOpsRunDetail(value: unknown): OpsRunDetail {
  const row = asObject(value, 'run detail');
  if (!Array.isArray(row.requests) || !Array.isArray(row.logs)) {
    throw new Error('run detail lists must be arrays');
  }
  return {
    run: parseOpsRun(row.run),
    requests: row.requests.map((item) => parseOpsRequest(item)),
    logs: row.logs.map((item) => parseOpsLog(item)),
  };
}

export function parseOpsHealth(value: unknown): OpsHealth {
  const row = asObject(value, 'ops health');
  return {
    lastHeartbeatAt: asNullableIso(row.lastHeartbeatAt, 'lastHeartbeatAt'),
    stale: asBoolean(row.stale, 'stale'),
    queueBacklog: asCount(row.queueBacklog, 'queueBacklog'),
    lastSuccessAt: asNullableIso(row.lastSuccessAt, 'lastSuccessAt'),
  };
}

export function parseOpsDebugBundle(value: unknown): OpsDebugBundle {
  const row = asObject(value, 'debug bundle');
  if (!Array.isArray(row.requests) || !Array.isArray(row.logs)) {
    throw new Error('debug bundle lists must be arrays');
  }
  if (!Array.isArray(row.heartbeats) || !Array.isArray(row.circuits)) {
    throw new Error('debug bundle lists must be arrays');
  }
  return {
    schemaVersion: asString(row.schemaVersion, 'schemaVersion'),
    generatedAt: asIso(row.generatedAt, 'generatedAt'),
    run: row.run === null ? null : parseOpsRun(row.run),
    target: row.target === null ? null : parseDebugTarget(row.target),
    requests: row.requests.map((item) => parseOpsRequest(item)),
    logs: row.logs.map((item) => parseOpsLog(item)),
    video: row.video === null ? null : parseDebugVideo(row.video),
    creator: row.creator === null ? null : parseDebugCreator(row.creator),
    heartbeats: row.heartbeats.map((item) => parseOpsHeartbeat(item)),
    circuits: row.circuits.map((item) => parseOpsCircuit(item)),
  };
}

function parseDebugTarget(value: unknown): OpsDebugTarget {
  const row = asObject(value, 'target');
  return {
    id: asString(row.id, 'id'),
    type: asString(row.type, 'type'),
    externalId: asString(row.externalId, 'externalId'),
    label: typeof row.label === 'string' ? row.label : '',
    enabled: asBoolean(row.enabled, 'enabled'),
    lastSuccessAt: asNullableIso(row.lastSuccessAt, 'lastSuccessAt'),
    lastError: asNullableString(row.lastError, 'lastError'),
  };
}

function parseDebugVideo(value: unknown): OpsDebugVideo {
  const row = asObject(value, 'video');
  return {
    bvid: asString(row.bvid, 'bvid'),
    title: asNullableString(row.title, 'title'),
    description: asNullableString(row.description, 'description'),
    durationSeconds:
      row.durationSeconds === null ? null : asCount(row.durationSeconds, 'durationSeconds'),
    coverUrl: asNullableString(row.coverUrl, 'coverUrl'),
    coverState: asString(row.coverState, 'coverState'),
    metadataState: asString(row.metadataState, 'metadataState'),
    metadataSource: asNullableString(row.metadataSource, 'metadataSource'),
    metadataFetchedAt: asNullableIso(row.metadataFetchedAt, 'metadataFetchedAt'),
    metadataError: asNullableString(row.metadataError, 'metadataError'),
    cid: asNullableString(row.cid, 'cid'),
    pubdate: asNullableIso(row.pubdate, 'pubdate'),
    tid: asNullableCount(row.tid, 'tid'),
    tidV2: asNullableCount(row.tidV2, 'tidV2'),
    partitionName: asNullableString(row.partitionName, 'partitionName'),
  };
}

function asNullableCount(value: unknown, name: string): number | null {
  if (value === null) return null;
  return asCount(value, name);
}

function parseDebugCreator(value: unknown): OpsDebugCreator {
  const row = asObject(value, 'creator');
  return {
    mid: asString(row.mid, 'mid'),
    uname: asNullableString(row.uname, 'uname'),
    faceUrl: asNullableString(row.faceUrl, 'faceUrl'),
    metadataState: asString(row.metadataState, 'metadataState'),
    metadataSource: asNullableString(row.metadataSource, 'metadataSource'),
    metadataFetchedAt: asNullableIso(row.metadataFetchedAt, 'metadataFetchedAt'),
    metadataError: asNullableString(row.metadataError, 'metadataError'),
  };
}
