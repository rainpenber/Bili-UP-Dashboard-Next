/** Commercial workflow write contracts (WP-004R2-3A). */

import {
  isOverallStage,
  isPublishSource,
  isUuidString,
  isWfNodeKind,
  isWfNodeStatus,
  type CommercialWorkflowNode,
  type OverallStage,
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
  'confirmation_required',
] as const;

export type CommercialWriteErrorCode = (typeof COMMERCIAL_WRITE_ERROR_CODES)[number];

export const OPEN_ITEM_LIFECYCLES = ['open', 'closed', 'cancelled'] as const;
export type OpenItemLifecycle = (typeof OPEN_ITEM_LIFECYCLES)[number];

export const OPEN_ITEM_IMPACTS = ['normal', 'blocking'] as const;
export type OpenItemImpact = (typeof OPEN_ITEM_IMPACTS)[number];

export const MONITOR_JOB_TYPES = ['metadata', 'metrics'] as const;
export type MonitorJobType = (typeof MONITOR_JOB_TYPES)[number];

export const PUBLISH_CONTENT_KINDS = ['video', 'post'] as const;
export type PublishContentKind = (typeof PUBLISH_CONTENT_KINDS)[number];

export const PUBLISH_PLATFORMS = [
  'bilibili',
  'xiaohongshu',
  'douyin',
  'wechat_channels',
  'other',
] as const;
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];

export function isPublishContentKind(value: unknown): value is PublishContentKind {
  return typeof value === 'string' && (PUBLISH_CONTENT_KINDS as readonly string[]).includes(value);
}

export function isPublishPlatform(value: unknown): value is PublishPlatform {
  return typeof value === 'string' && (PUBLISH_PLATFORMS as readonly string[]).includes(value);
}

export type CommercialStepEffect = {
  nodeId: string;
  nodeName: string;
  from: WfNodeStatus;
  to: WfNodeStatus;
};

export type CommercialStepBlock = {
  nodeId: string;
  nodeName: string;
  reason: string | null;
  itemId: string | null;
};

export type CommercialStepSuccessor = {
  nodeId: string;
  nodeName: string;
  templateSlug: string | null;
};

export type CommercialWriteErrorBody = {
  error: string;
  code: CommercialWriteErrorCode;
  /** Offending node names, in refusal order. */
  names?: string[];
  /** Open blocks that must be confirmed before a forward step writes. */
  blocks?: CommercialStepBlock[];
  /** Status changes the step would make. Present on confirmation and publish refusals. */
  effects?: CommercialStepEffect[];
  /** Business successors that have to be rolled back first. */
  successors?: CommercialStepSuccessor[];
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
    /** Null for post deliveries, which have no bvid. */
    bvid: string | null;
    publishedAt: string;
    publishSource: PublishSource;
    idempotencyKey: string;
    platform: string;
    videoUrl: string | null;
    contentKind: PublishContentKind;
    contentUrl: string | null;
    externalId: string | null;
  };
  /** Null for post deliveries: monitoring is video-only. */
  monitor: {
    contractId: string;
    bvid: string;
    metadataTaskStatus: string;
    jobs: CommercialMonitorJobSnapshot[];
  } | null;
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
  platform: PublishPlatform;
  /** Defaults to video. */
  contentKind?: PublishContentKind;
  bvid?: string;
  videoUrl?: string;
  /** Required for post deliveries. */
  contentUrl?: string;
  /** Derived from contentUrl when omitted on a post delivery. */
  externalId?: string;
  publishedAt?: string;
  publishSource?: PublishSource;
};

export type CommercialStepDirection = 'forward' | 'rollback';

export type CommercialStepPublish = {
  idempotencyKey: string;
  platform: PublishPlatform;
  contentKind?: PublishContentKind;
  bvid?: string;
  videoUrl?: string;
  contentUrl?: string;
  externalId?: string;
  publishedAt?: string;
  publishSource?: PublishSource;
};

export type CommercialNodeStepRequest = {
  expectedUpdatedAt: string;
  direction: CommercialStepDirection;
  force: boolean;
  publish: CommercialStepPublish | null;
};

export type CommercialStageStepToken = {
  nodeId: string;
  expectedUpdatedAt: string;
};

export type CommercialStageStepRequest = {
  direction: CommercialStepDirection;
  tokens: CommercialStageStepToken[];
  force: boolean;
  publish: CommercialStepPublish | null;
};

export type CommercialStepResponse = {
  projectId: string;
  overallStage: OverallStage;
  nodes: CommercialNodeSnapshot[];
};

/** Max length for wf_nodes.name on layout / rename writes (WP-R2-21A). */
export const COMMERCIAL_WORKFLOW_NODE_NAME_MAX = 60;

export type CommercialWorkflowLayoutNodePatch = {
  nodeId: string;
  expectedUpdatedAt: string;
  /** Trimmed non-empty name. Omit to leave the stored name unchanged. */
  name?: string;
  /** Canvas X. Omit to leave the stored pos_x unchanged. */
  posX?: number;
  /** Canvas Y. Omit to leave the stored pos_y unchanged. */
  posY?: number;
};

/**
 * Batch rename / position save. The node id set must match the workflow exactly.
 * Edges are never modified by this route.
 */
export type CommercialWorkflowLayoutRequest = {
  nodes: CommercialWorkflowLayoutNodePatch[];
};

export type CommercialWorkflowLayoutResponse = {
  projectId: string;
  /** Latest node updatedAt among the workflow after the write. */
  updatedAt: string;
  /** Same shape as GET .../workflow nodes. */
  nodes: CommercialWorkflowNode[];
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

function parseNullableName(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : parseName(value, label);
}

export function parseCommercialPublishResponse(value: unknown): CommercialPublishResponse {
  const record = asRecord(value, 'publish result');
  const publish = asRecord(record.publish, 'publish');
  const contentKind =
    publish.contentKind === undefined || publish.contentKind === null
      ? 'video'
      : publish.contentKind;
  if (!isPublishContentKind(contentKind)) throw new Error('contentKind is invalid');
  if (!isPublishSource(publish.publishSource)) throw new Error('publishSource is invalid');
  if (typeof record.idempotentReplay !== 'boolean') {
    throw new Error('idempotentReplay must be a boolean');
  }
  const bvid = parseNullableName(publish.bvid, 'bvid');
  const contentUrl = parseNullableName(publish.contentUrl, 'contentUrl');
  const externalId = parseNullableName(publish.externalId, 'externalId');
  const videoUrl = parseNullableName(publish.videoUrl, 'videoUrl');
  if (contentKind === 'video' && bvid === null) throw new Error('video publish requires bvid');
  if (contentKind === 'post' && contentUrl === null) {
    throw new Error('post publish requires contentUrl');
  }
  const monitor =
    record.monitor === null || record.monitor === undefined
      ? null
      : parseMonitorBundle(record.monitor);
  if (contentKind === 'video' && monitor === null) {
    throw new Error('video publish requires a monitor contract');
  }
  return {
    projectId: parseUuid(record.projectId, 'projectId'),
    node: parseCommercialNodeSnapshot(record.node),
    publish: {
      bvid,
      publishedAt: parseIso(publish.publishedAt, 'publishedAt'),
      publishSource: publish.publishSource,
      idempotencyKey: parseName(publish.idempotencyKey, 'idempotencyKey'),
      platform: parseName(publish.platform, 'platform'),
      videoUrl,
      contentKind,
      contentUrl,
      externalId,
    },
    monitor,
    idempotentReplay: record.idempotentReplay,
  };
}

function parseMonitorBundle(value: unknown): NonNullable<CommercialPublishResponse['monitor']> {
  const monitor = asRecord(value, 'monitor');
  if (!Array.isArray(monitor.jobs)) throw new Error('jobs must be an array');
  return {
    contractId: parseUuid(monitor.contractId, 'contractId'),
    bvid: parseName(monitor.bvid, 'monitor.bvid'),
    metadataTaskStatus: parseName(monitor.metadataTaskStatus, 'metadataTaskStatus'),
    jobs: monitor.jobs.map((job) => parseJob(job)),
  };
}

function parseStepEffect(value: unknown, index: number): CommercialStepEffect {
  const record = asRecord(value, `effects[${index}]`);
  if (!isWfNodeStatus(record.from) || !isWfNodeStatus(record.to)) {
    throw new Error(`effects[${index}] status is invalid`);
  }
  return {
    nodeId: parseUuid(record.nodeId, `effects[${index}].nodeId`),
    nodeName: parseName(record.nodeName, `effects[${index}].nodeName`),
    from: record.from,
    to: record.to,
  };
}

function parseStepBlock(value: unknown, index: number): CommercialStepBlock {
  const record = asRecord(value, `blocks[${index}]`);
  const reason =
    record.reason === null ? null : parseName(record.reason, `blocks[${index}].reason`);
  return {
    nodeId: parseUuid(record.nodeId, `blocks[${index}].nodeId`),
    nodeName: parseName(record.nodeName, `blocks[${index}].nodeName`),
    reason,
    itemId: record.itemId === null ? null : parseUuid(record.itemId, `blocks[${index}].itemId`),
  };
}

function parseStepSuccessor(value: unknown, index: number): CommercialStepSuccessor {
  const record = asRecord(value, `successors[${index}]`);
  return {
    nodeId: parseUuid(record.nodeId, `successors[${index}].nodeId`),
    nodeName: parseName(record.nodeName, `successors[${index}].nodeName`),
    templateSlug:
      record.templateSlug === null
        ? null
        : parseName(record.templateSlug, `successors[${index}].templateSlug`),
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
  if (record.blocks !== undefined) {
    if (!Array.isArray(record.blocks)) throw new Error('blocks must be an array');
    body.blocks = record.blocks.map((item, index) => parseStepBlock(item, index));
  }
  if (record.effects !== undefined) {
    if (!Array.isArray(record.effects)) throw new Error('effects must be an array');
    body.effects = record.effects.map((item, index) => parseStepEffect(item, index));
  }
  if (record.successors !== undefined) {
    if (!Array.isArray(record.successors)) throw new Error('successors must be an array');
    body.successors = record.successors.map((item, index) => parseStepSuccessor(item, index));
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

function parseContentKind(value: unknown): PublishContentKind {
  if (value === undefined || value === null) return 'video';
  if (!isPublishContentKind(value)) throw new Error('contentKind is invalid');
  return value;
}

/** Last path segment of a platform content link (query, hash, and slash stripped). */
export function extractExternalIdFromContentUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let last = '';
  try {
    const segments = new URL(trimmed).pathname.split('/').filter((part) => part.length > 0);
    last = segments[segments.length - 1] ?? '';
  } catch {
    const withoutQuery = trimmed.split(/[?#]/)[0] ?? '';
    const segments = withoutQuery
      .replace(/\/+$/, '')
      .split('/')
      .filter((part) => part.length > 0);
    last = segments[segments.length - 1] ?? '';
  }
  if (last.length === 0) return null;
  const decoded = decodeURIComponent(last);
  return decoded.length > 0 ? decoded : null;
}

type ParsedPublishFields = {
  platform: PublishPlatform;
  contentKind: PublishContentKind;
  bvid?: string;
  videoUrl?: string;
  contentUrl?: string;
  externalId?: string;
  publishedAt?: string;
  publishSource?: PublishSource;
};

function parsePublishFields(record: Record<string, unknown>): ParsedPublishFields {
  const contentKind = parseContentKind(record.contentKind);
  const fields: ParsedPublishFields = {
    platform: parseName(record.platform, 'platform') as PublishPlatform,
    contentKind,
  };
  if (record.bvid !== undefined && record.bvid !== null) {
    fields.bvid = parseName(record.bvid, 'bvid');
  }
  if (record.videoUrl !== undefined && record.videoUrl !== null) {
    fields.videoUrl = parseName(record.videoUrl, 'videoUrl');
  }
  if (record.contentUrl !== undefined && record.contentUrl !== null) {
    fields.contentUrl = parseName(record.contentUrl, 'contentUrl');
  }
  if (record.externalId !== undefined && record.externalId !== null) {
    fields.externalId = parseName(record.externalId, 'externalId');
  }
  if (contentKind === 'video') {
    if (fields.bvid === undefined && fields.videoUrl === undefined) {
      throw new Error('bvid or videoUrl is required');
    }
  } else {
    if (fields.contentUrl === undefined) {
      throw new Error('contentUrl is required for post deliveries');
    }
    if (fields.externalId === undefined) {
      const derived = extractExternalIdFromContentUrl(fields.contentUrl);
      if (derived === null) {
        throw new Error('externalId is required when contentUrl has no trailing id');
      }
      fields.externalId = derived;
    }
  }
  if (record.publishedAt !== undefined && record.publishedAt !== null) {
    fields.publishedAt = parseIso(record.publishedAt, 'publishedAt');
  }
  if (record.publishSource !== undefined && record.publishSource !== null) {
    if (!isPublishSource(record.publishSource)) throw new Error('publishSource is invalid');
    fields.publishSource = record.publishSource;
  }
  return fields;
}

export function parseCommercialPublishRequest(value: unknown): CommercialPublishRequest {
  const record = asRecord(value, 'publish request');
  return {
    expectedUpdatedAt: parseIso(record.expectedUpdatedAt, 'expectedUpdatedAt'),
    idempotencyKey: parseName(record.idempotencyKey, 'idempotencyKey'),
    ...parsePublishFields(record),
  };
}

function parseDirection(value: unknown): CommercialStepDirection {
  if (value !== 'forward' && value !== 'rollback') {
    throw new Error('direction must be forward or rollback');
  }
  return value;
}

function parseForce(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw new Error('force must be a boolean');
  return value;
}

function parseStepPublish(value: unknown): CommercialStepPublish | null {
  if (value === undefined || value === null) return null;
  const record = asRecord(value, 'publish');
  return {
    idempotencyKey: parseName(record.idempotencyKey, 'idempotencyKey'),
    ...parsePublishFields(record),
  };
}

export function parseCommercialNodeStepRequest(value: unknown): CommercialNodeStepRequest {
  const record = asRecord(value, 'node step');
  return {
    expectedUpdatedAt: parseIso(record.expectedUpdatedAt, 'expectedUpdatedAt'),
    direction: parseDirection(record.direction),
    force: parseForce(record.force),
    publish: parseStepPublish(record.publish),
  };
}

export function parseCommercialStageStepRequest(value: unknown): CommercialStageStepRequest {
  const record = asRecord(value, 'stage step');
  if (!Array.isArray(record.tokens) || record.tokens.length === 0) {
    throw new Error('tokens must list the stage nodes');
  }
  return {
    direction: parseDirection(record.direction),
    force: parseForce(record.force),
    publish: parseStepPublish(record.publish),
    tokens: record.tokens.map((item, index) => {
      const token = asRecord(item, `tokens[${index}]`);
      return {
        nodeId: parseUuid(token.nodeId, `tokens[${index}].nodeId`),
        expectedUpdatedAt: parseIso(token.expectedUpdatedAt, `tokens[${index}].expectedUpdatedAt`),
      };
    }),
  };
}

export function parseCommercialStepResponse(value: unknown): CommercialStepResponse {
  const record = asRecord(value, 'step result');
  if (!isOverallStage(record.overallStage)) throw new Error('overallStage is invalid');
  if (!Array.isArray(record.nodes)) throw new Error('nodes must be an array');
  return {
    projectId: parseUuid(record.projectId, 'projectId'),
    overallStage: record.overallStage,
    nodes: record.nodes.map((node) => parseCommercialNodeSnapshot(node)),
  };
}

function parseFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function parseLayoutNodeName(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label} must be a non-empty string`);
  if (trimmed.length > COMMERCIAL_WORKFLOW_NODE_NAME_MAX) {
    throw new Error(`${label} must be at most ${COMMERCIAL_WORKFLOW_NODE_NAME_MAX} characters`);
  }
  return trimmed;
}

function parseLayoutNodePatch(value: unknown, index: number): CommercialWorkflowLayoutNodePatch {
  const record = asRecord(value, `nodes[${index}]`);
  const patch: CommercialWorkflowLayoutNodePatch = {
    nodeId: parseUuid(record.nodeId, `nodes[${index}].nodeId`),
    expectedUpdatedAt: parseIso(record.expectedUpdatedAt, `nodes[${index}].expectedUpdatedAt`),
  };
  if (record.name !== undefined) {
    patch.name = parseLayoutNodeName(record.name, `nodes[${index}].name`);
  }
  if (record.posX !== undefined) {
    patch.posX = parseFiniteNumber(record.posX, `nodes[${index}].posX`);
  }
  if (record.posY !== undefined) {
    patch.posY = parseFiniteNumber(record.posY, `nodes[${index}].posY`);
  }
  return patch;
}

/**
 * Layout / rename batch. The node id set must match the workflow exactly (no add/drop).
 * Unchanged rows may send only nodeId + expectedUpdatedAt; at least one row must patch
 * name, posX, or posY.
 */
export function parseCommercialWorkflowLayoutRequest(
  value: unknown,
): CommercialWorkflowLayoutRequest {
  const record = asRecord(value, 'layout request');
  if (!Array.isArray(record.nodes) || record.nodes.length === 0) {
    throw new Error('nodes must be a non-empty array');
  }
  const nodes = record.nodes.map((item, index) => parseLayoutNodePatch(item, index));
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.nodeId)) throw new Error('nodes must not list the same nodeId twice');
    seen.add(node.nodeId);
  }
  const hasChange = nodes.some(
    (node) => node.name !== undefined || node.posX !== undefined || node.posY !== undefined,
  );
  if (!hasChange) {
    throw new Error('nodes must include at least one name, posX, or posY change');
  }
  return { nodes };
}

function parseLayoutResponseNode(value: unknown): CommercialWorkflowNode {
  const record = asRecord(value, 'layout node');
  if (!isWfNodeStatus(record.status)) throw new Error('node status is invalid');
  if (!isWfNodeKind(record.kind)) throw new Error('node kind is invalid');
  const blockingReason =
    record.blockingReason === null || record.blockingReason === undefined
      ? null
      : parseName(record.blockingReason, 'blockingReason');
  const templateSlug =
    record.templateSlug === null || record.templateSlug === undefined
      ? null
      : parseName(record.templateSlug, 'templateSlug');
  return {
    id: parseUuid(record.id, 'node id'),
    name: parseName(record.name, 'node name'),
    status: record.status,
    kind: record.kind,
    templateSlug,
    blockingReason,
    plannedAt: parseNullableIso(record.plannedAt, 'plannedAt'),
    completedAt: parseNullableIso(record.completedAt, 'completedAt'),
    posX: parseFiniteNumber(record.posX, 'posX'),
    posY: parseFiniteNumber(record.posY, 'posY'),
    updatedAt: parseIso(record.updatedAt, 'updatedAt'),
  };
}

export function parseCommercialWorkflowLayoutResponse(
  value: unknown,
): CommercialWorkflowLayoutResponse {
  const record = asRecord(value, 'layout result');
  if (!Array.isArray(record.nodes)) throw new Error('nodes must be an array');
  return {
    projectId: parseUuid(record.projectId, 'projectId'),
    updatedAt: parseIso(record.updatedAt, 'updatedAt'),
    nodes: record.nodes.map((node) => parseLayoutResponseNode(node)),
  };
}
