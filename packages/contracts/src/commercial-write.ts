/** Commercial workflow write contracts (WP-004R2-3A). */

import {
  isPublishSource,
  isUuidString,
  isWfNodeKind,
  isWfNodeStatus,
  type PublishSource,
  type WfNodeKind,
  type WfNodeStatus,
} from './commercial';

export const COMMERCIAL_WRITE_ERROR_CODES = [
  'predecessors_incomplete',
  'successors_advanced',
  'stale_write',
  'invalid_transition',
  'constraint_violation',
  'not_found',
  'publish_required',
  'publish_conflict',
  'unsupported_platform',
  'not_applicable_block',
  'invalid_body',
] as const;

export type CommercialWriteErrorCode = (typeof COMMERCIAL_WRITE_ERROR_CODES)[number];

export const OPEN_ITEM_LIFECYCLES = ['open', 'closed', 'cancelled'] as const;
export type OpenItemLifecycle = (typeof OPEN_ITEM_LIFECYCLES)[number];

export const OPEN_ITEM_IMPACTS = ['normal', 'blocking'] as const;
export type OpenItemImpact = (typeof OPEN_ITEM_IMPACTS)[number];

export const MONITOR_JOB_TYPES = ['metadata', 'metrics'] as const;
export type MonitorJobType = (typeof MONITOR_JOB_TYPES)[number];

export type CommercialWriteErrorBody = {
  error: string;
  code: CommercialWriteErrorCode;
  /** Offending node names, in refusal order. */
  names?: string[];
};

export type CommercialNodeSnapshot = {
  id: string;
  name: string;
  status: WfNodeStatus;
  kind: WfNodeKind;
  updatedAt: string;
  statusBeforeBlock: WfNodeStatus | null;
  primaryBlockItemId: string | null;
  /** Unchanged by status writes. Null when the node has no plan. */
  plannedAt: string | null;
  completedAt: string | null;
};

export type CommercialPinnedBlockItem = {
  id: string;
  title: string;
  lifecycle: OpenItemLifecycle;
  impact: 'blocking';
  updatedAt: string;
};

export type CommercialNodeWriteResponse = {
  projectId: string;
  node: CommercialNodeSnapshot;
  /** Null when the block has no open-item reason. Never an empty string. */
  blockingReason: string | null;
  pinnedItem: CommercialPinnedBlockItem | null;
};

export type CommercialOpenItemSnapshot = {
  id: string;
  title: string;
  lifecycle: OpenItemLifecycle;
  impact: OpenItemImpact;
  updatedAt: string;
  cancelReason: string | null;
};

export type CommercialOpenItemWriteResponse = {
  projectId: string;
  item: CommercialOpenItemSnapshot;
  liftedNodes: CommercialNodeSnapshot[];
};

export type CommercialMonitorJobSnapshot = {
  id: string;
  jobType: MonitorJobType;
  status: string;
};

export type CommercialPublishResponse = {
  projectId: string;
  node: CommercialNodeSnapshot;
  publish: {
    bvid: string;
    publishedAt: string;
    publishSource: PublishSource;
    idempotencyKey: string;
    platform: string;
    videoUrl: string | null;
  };
  monitor: {
    contractId: string;
    bvid: string;
    metadataTaskStatus: string;
    jobs: CommercialMonitorJobSnapshot[];
  };
  idempotentReplay: boolean;
};

export type CommercialNodeTokenRequest = {
  expectedUpdatedAt: string;
};

/** Calendar date in Asia/Shanghai, or null to clear. Not a timestamp. */
export type CommercialPlanRequest = {
  expectedUpdatedAt: string;
  plannedAt: string | null;
};

export type CommercialBlockRequest = {
  expectedUpdatedAt: string;
  reason?: string | null;
  openItemId?: string | null;
};

export type CommercialCloseItemRequest = {
  expectedUpdatedAt: string;
  closeConclusion?: string | null;
};

export type CommercialCancelItemRequest = {
  expectedUpdatedAt: string;
  /** Passed through to the database. A blank value is rejected by the check constraint. */
  cancelReason: string;
};

export type CommercialPublishRequest = {
  expectedUpdatedAt: string;
  idempotencyKey: string;
  platform: string;
  bvid?: string;
  videoUrl?: string;
  publishedAt?: string;
  publishSource?: PublishSource;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseUuid(value: unknown, label: string): string {
  if (!isUuidString(value)) throw new Error(`${label} must be a uuid`);
  return value;
}

function parseName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function parseIso(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date string`);
  }
  return value;
}

function parseNullableIso(value: unknown, label: string): string | null {
  if (value === null) return null;
  return parseIso(value, label);
}

function isWriteErrorCode(value: unknown): value is CommercialWriteErrorCode {
  return (
    typeof value === 'string' && (COMMERCIAL_WRITE_ERROR_CODES as readonly string[]).includes(value)
  );
}

function isLifecycle(value: unknown): value is OpenItemLifecycle {
  return typeof value === 'string' && (OPEN_ITEM_LIFECYCLES as readonly string[]).includes(value);
}

function isImpact(value: unknown): value is OpenItemImpact {
  return typeof value === 'string' && (OPEN_ITEM_IMPACTS as readonly string[]).includes(value);
}

function isJobType(value: unknown): value is MonitorJobType {
  return typeof value === 'string' && (MONITOR_JOB_TYPES as readonly string[]).includes(value);
}

function parseOptionalStatus(value: unknown, label: string): WfNodeStatus | null {
  if (value === null) return null;
  if (!isWfNodeStatus(value)) throw new Error(`${label} is invalid`);
  return value;
}

export function parseCommercialNodeSnapshot(value: unknown): CommercialNodeSnapshot {
  const record = asRecord(value, 'node');
  if (!isWfNodeStatus(record.status)) throw new Error('node status is invalid');
  if (!isWfNodeKind(record.kind)) throw new Error('node kind is invalid');
  return {
    id: parseUuid(record.id, 'node id'),
    name: parseName(record.name, 'node name'),
    status: record.status,
    kind: record.kind,
    updatedAt: parseIso(record.updatedAt, 'updatedAt'),
    statusBeforeBlock: parseOptionalStatus(record.statusBeforeBlock, 'statusBeforeBlock'),
    primaryBlockItemId:
      record.primaryBlockItemId === null
        ? null
        : parseUuid(record.primaryBlockItemId, 'primaryBlockItemId'),
    plannedAt: parseNullableIso(record.plannedAt, 'plannedAt'),
    completedAt: parseNullableIso(record.completedAt, 'completedAt'),
  };
}

function parsePinnedItem(value: unknown): CommercialPinnedBlockItem | null {
  if (value === null) return null;
  const record = asRecord(value, 'pinnedItem');
  if (record.impact !== 'blocking') throw new Error('pinnedItem.impact must be blocking');
  if (!isLifecycle(record.lifecycle)) throw new Error('pinnedItem.lifecycle is invalid');
  const title = parseName(record.title, 'pinnedItem.title');
  return {
    id: parseUuid(record.id, 'pinnedItem.id'),
    title,
    lifecycle: record.lifecycle,
    impact: 'blocking',
    updatedAt: parseIso(record.updatedAt, 'pinnedItem.updatedAt'),
  };
}

function parseBlockingReason(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('blockingReason must be a non-empty string or null');
  }
  if (value !== value.trim())
    throw new Error('blockingReason must not carry surrounding whitespace');
  return value;
}

export function parseCommercialNodeWriteResponse(value: unknown): CommercialNodeWriteResponse {
  const record = asRecord(value, 'node write');
  return {
    projectId: parseUuid(record.projectId, 'projectId'),
    node: parseCommercialNodeSnapshot(record.node),
    blockingReason: parseBlockingReason(record.blockingReason),
    pinnedItem: parsePinnedItem(record.pinnedItem),
  };
}

export function parseCommercialOpenItemSnapshot(value: unknown): CommercialOpenItemSnapshot {
  const record = asRecord(value, 'open item');
  if (!isLifecycle(record.lifecycle)) throw new Error('lifecycle is invalid');
  if (!isImpact(record.impact)) throw new Error('impact is invalid');
  const cancelReason =
    record.cancelReason === null ? null : parseName(record.cancelReason, 'cancelReason');
  if (record.lifecycle === 'cancelled' && cancelReason === null) {
    throw new Error('cancelled item requires cancelReason');
  }
  if (record.lifecycle !== 'cancelled' && cancelReason !== null) {
    throw new Error('cancelReason is only present when cancelled');
  }
  return {
    id: parseUuid(record.id, 'item id'),
    title: parseName(record.title, 'title'),
    lifecycle: record.lifecycle,
    impact: record.impact,
    updatedAt: parseIso(record.updatedAt, 'updatedAt'),
    cancelReason,
  };
}

export function parseCommercialOpenItemWriteResponse(
  value: unknown,
): CommercialOpenItemWriteResponse {
  const record = asRecord(value, 'open item write');
  if (!Array.isArray(record.liftedNodes)) throw new Error('liftedNodes must be an array');
  return {
    projectId: parseUuid(record.projectId, 'projectId'),
    item: parseCommercialOpenItemSnapshot(record.item),
    liftedNodes: record.liftedNodes.map((node) => parseCommercialNodeSnapshot(node)),
  };
}

function parseJob(value: unknown): CommercialMonitorJobSnapshot {
  const record = asRecord(value, 'monitor job');
  if (!isJobType(record.jobType)) throw new Error('jobType is invalid');
  return {
    id: parseUuid(record.id, 'job id'),
    jobType: record.jobType,
    status: parseName(record.status, 'job status'),
  };
}

export function parseCommercialPublishResponse(value: unknown): CommercialPublishResponse {
  const record = asRecord(value, 'publish result');
  const publish = asRecord(record.publish, 'publish');
  const monitor = asRecord(record.monitor, 'monitor');
  if (!isPublishSource(publish.publishSource)) throw new Error('publishSource is invalid');
  if (typeof record.idempotentReplay !== 'boolean') {
    throw new Error('idempotentReplay must be a boolean');
  }
  if (!Array.isArray(monitor.jobs)) throw new Error('jobs must be an array');
  const videoUrl = publish.videoUrl === null ? null : parseName(publish.videoUrl, 'videoUrl');
  return {
    projectId: parseUuid(record.projectId, 'projectId'),
    node: parseCommercialNodeSnapshot(record.node),
    publish: {
      bvid: parseName(publish.bvid, 'bvid'),
      publishedAt: parseIso(publish.publishedAt, 'publishedAt'),
      publishSource: publish.publishSource,
      idempotencyKey: parseName(publish.idempotencyKey, 'idempotencyKey'),
      platform: parseName(publish.platform, 'platform'),
      videoUrl,
    },
    monitor: {
      contractId: parseUuid(monitor.contractId, 'contractId'),
      bvid: parseName(monitor.bvid, 'monitor.bvid'),
      metadataTaskStatus: parseName(monitor.metadataTaskStatus, 'metadataTaskStatus'),
      jobs: monitor.jobs.map((job) => parseJob(job)),
    },
    idempotentReplay: record.idempotentReplay,
  };
}

export function parseCommercialWriteError(value: unknown): CommercialWriteErrorBody {
  const record = asRecord(value, 'write error');
  if (!isWriteErrorCode(record.code)) throw new Error('error code is invalid');
  const body: CommercialWriteErrorBody = {
    error: parseName(record.error, 'error'),
    code: record.code,
  };
  if (record.names !== undefined) {
    if (!Array.isArray(record.names)) throw new Error('names must be an array');
    body.names = record.names.map((item, index) => parseName(item, `names[${index}]`));
  }
  return body;
}

export function parseCommercialNodeTokenRequest(value: unknown): CommercialNodeTokenRequest {
  const record = asRecord(value, 'node write');
  return { expectedUpdatedAt: parseIso(record.expectedUpdatedAt, 'expectedUpdatedAt') };
}

const PLAN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Accept a calendar date or null. Reject timestamps so midnight is not stored as an agreed time. */
export function parseCommercialPlanRequest(value: unknown): CommercialPlanRequest {
  const record = asRecord(value, 'plan request');
  let plannedAt: string | null;
  if (record.plannedAt === null) {
    plannedAt = null;
  } else if (typeof record.plannedAt === 'string' && PLAN_DATE_RE.test(record.plannedAt)) {
    const match = PLAN_DATE_RE.exec(record.plannedAt);
    const year = Number(match?.[1]);
    const month = Number(match?.[2]);
    const day = Number(match?.[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      throw new Error('plannedAt must be a real calendar date');
    }
    plannedAt = record.plannedAt;
  } else {
    throw new Error('plannedAt must be a YYYY-MM-DD date or null');
  }
  return {
    expectedUpdatedAt: parseIso(record.expectedUpdatedAt, 'expectedUpdatedAt'),
    plannedAt,
  };
}

export function parseCommercialBlockRequest(value: unknown): CommercialBlockRequest {
  const record = asRecord(value, 'block request');
  const request: CommercialBlockRequest = {
    expectedUpdatedAt: parseIso(record.expectedUpdatedAt, 'expectedUpdatedAt'),
  };
  if (record.reason !== undefined) {
    if (record.reason !== null && typeof record.reason !== 'string') {
      throw new Error('reason must be a string or null');
    }
    request.reason = record.reason;
  }
  if (record.openItemId !== undefined) {
    request.openItemId =
      record.openItemId === null ? null : parseUuid(record.openItemId, 'openItemId');
  }
  return request;
}

export function parseCommercialCloseItemRequest(value: unknown): CommercialCloseItemRequest {
  const record = asRecord(value, 'close request');
  const request: CommercialCloseItemRequest = {
    expectedUpdatedAt: parseIso(record.expectedUpdatedAt, 'expectedUpdatedAt'),
  };
  if (record.closeConclusion !== undefined) {
    if (record.closeConclusion !== null && typeof record.closeConclusion !== 'string') {
      throw new Error('closeConclusion must be a string or null');
    }
    request.closeConclusion = record.closeConclusion;
  }
  return request;
}

export function parseCommercialCancelItemRequest(value: unknown): CommercialCancelItemRequest {
  const record = asRecord(value, 'cancel request');
  if (typeof record.cancelReason !== 'string') {
    throw new Error('cancelReason must be a string');
  }
  return {
    expectedUpdatedAt: parseIso(record.expectedUpdatedAt, 'expectedUpdatedAt'),
    cancelReason: record.cancelReason,
  };
}

export function parseCommercialPublishRequest(value: unknown): CommercialPublishRequest {
  const record = asRecord(value, 'publish request');
  const request: CommercialPublishRequest = {
    expectedUpdatedAt: parseIso(record.expectedUpdatedAt, 'expectedUpdatedAt'),
    idempotencyKey: parseName(record.idempotencyKey, 'idempotencyKey'),
    platform: parseName(record.platform, 'platform'),
  };
  if (record.bvid !== undefined && record.bvid !== null) {
    request.bvid = parseName(record.bvid, 'bvid');
  }
  if (record.videoUrl !== undefined && record.videoUrl !== null) {
    request.videoUrl = parseName(record.videoUrl, 'videoUrl');
  }
  if (request.bvid === undefined && request.videoUrl === undefined) {
    throw new Error('bvid or videoUrl is required');
  }
  if (record.publishedAt !== undefined && record.publishedAt !== null) {
    request.publishedAt = parseIso(record.publishedAt, 'publishedAt');
  }
  if (record.publishSource !== undefined && record.publishSource !== null) {
    if (!isPublishSource(record.publishSource)) throw new Error('publishSource is invalid');
    request.publishSource = record.publishSource;
  }
  return request;
}
