/** Commercial domain enums and read-only API shapes (WP-004R2-2). */

export const OVERALL_STAGES = [
  'pre_publish',
  'published_winding_down',
  'closed',
  'archived',
] as const;
export type OverallStage = (typeof OVERALL_STAGES)[number];

export const WF_NODE_STATUSES = [
  'not_reached',
  'in_progress',
  'completed',
  'blocked',
  'not_applicable',
] as const;
export type WfNodeStatus = (typeof WF_NODE_STATUSES)[number];

export const WF_NODE_KINDS = ['stage', 'merge'] as const;
export type WfNodeKind = (typeof WF_NODE_KINDS)[number];

export const WF_NODE_PHASES = [
  'pre_publish',
  'post_publish_required',
  'post_publish_optional',
] as const;
export type WfNodePhase = (typeof WF_NODE_PHASES)[number];

export const PUBLISH_SOURCES = ['web', 'hermes', 'manual'] as const;
export type PublishSource = (typeof PUBLISH_SOURCES)[number];

export const OPEN_ITEM_ACTORS = ['us', 'client'] as const;
export type OpenItemActor = (typeof OPEN_ITEM_ACTORS)[number];

const OPEN_ITEM_LIFECYCLES = ['open', 'closed', 'cancelled'] as const;
const OPEN_ITEM_IMPACTS = ['normal', 'blocking'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export function isUuidString(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isOverallStage(value: unknown): value is OverallStage {
  return typeof value === 'string' && (OVERALL_STAGES as readonly string[]).includes(value);
}

export function isWfNodeStatus(value: unknown): value is WfNodeStatus {
  return typeof value === 'string' && (WF_NODE_STATUSES as readonly string[]).includes(value);
}

export function isWfNodeKind(value: unknown): value is WfNodeKind {
  return typeof value === 'string' && (WF_NODE_KINDS as readonly string[]).includes(value);
}

export function isPublishSource(value: unknown): value is PublishSource {
  return typeof value === 'string' && (PUBLISH_SOURCES as readonly string[]).includes(value);
}

export function isOpenItemActor(value: unknown): value is OpenItemActor {
  return typeof value === 'string' && (OPEN_ITEM_ACTORS as readonly string[]).includes(value);
}

export function isOpenItemLifecycle(
  value: unknown,
): value is (typeof OPEN_ITEM_LIFECYCLES)[number] {
  return typeof value === 'string' && (OPEN_ITEM_LIFECYCLES as readonly string[]).includes(value);
}

export function isOpenItemImpact(value: unknown): value is (typeof OPEN_ITEM_IMPACTS)[number] {
  return typeof value === 'string' && (OPEN_ITEM_IMPACTS as readonly string[]).includes(value);
}

/** One open_items row. Nested under the owning project; project_id is the parent id. */
export type CommercialOpenItemRead = {
  id: string;
  title: string;
  description: string | null;
  closeCriteria: string | null;
  nextAction: string | null;
  nextActor: OpenItemActor;
  lifecycle: (typeof OPEN_ITEM_LIFECYCLES)[number];
  impact: (typeof OPEN_ITEM_IMPACTS)[number];
  /** open_items.planned_at. Null means no planned time was stored. */
  plannedAt: string | null;
  sortRank: number;
  blocksRequiredForClose: boolean;
  workflowNodeId: string | null;
  blocksNodeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const COMMERCIAL_ORIGIN_KINDS = ['real', 'fixture', 'manual'] as const;
export type CommercialOriginKind = (typeof COMMERCIAL_ORIGIN_KINDS)[number];

export function isCommercialOriginKind(value: unknown): value is CommercialOriginKind {
  return (
    typeof value === 'string' && (COMMERCIAL_ORIGIN_KINDS as readonly string[]).includes(value)
  );
}

/** Read-only source binding summary. Full payload lives on the ingress lookup route. */
export type CommercialProjectSourceSummary = {
  namespace: string;
  sourceId: string;
  sourceUpdatedAt: string;
  importedAt: string;
  contentHash: string;
  sourceStatus: string | null;
  sourceNotes: string | null;
};

export type CommercialProjectListItem = {
  id: string;
  name: string;
  /** 到手金额, numeric(14,2) text. */
  netAmount: string | null;
  /** 返点金额, numeric(14,2) text. */
  rebateAmount: string | null;
  overallStage: OverallStage;
  /** Names of in-progress and blocked nodes, layout order. Empty when none are active. */
  currentStageNames: string[];
  anyNodeBlocked: boolean;
  /** Chosen open blocking-item title, or null when a block has no stored reason. */
  blockingReason: string | null;
  /** commercial_projects.created_at. Always stored. */
  createdAt: string;
  /** commercial_projects.updated_at. Concurrency token for ingress updates. */
  updatedAt: string;
  /** commercial_projects.user_deadline_at. Null when no external deadline was stored. */
  userDeadlineAt: string | null;
  /** commercial_projects.blocked_since_at. Null when no block start was stored. */
  blockedSinceAt: string | null;
  /** commercial_projects.archived_at. Null when the row has no archive timestamp. */
  archivedAt: string | null;
  /** commercial_projects.stage_entered_at. */
  stageEnteredAt: string;
  /** commercial_projects.business_closed_at. */
  businessClosedAt: string | null;
  /**
   * Declared origin. Null means unclassified (not mass-labeled as fixture or real).
   * Fixture IDs are marked explicitly; missing real ingress stays empty.
   */
  originKind: CommercialOriginKind | null;
  /** Present when a commercial_project_sources row is bound. */
  source: CommercialProjectSourceSummary | null;
  /** Names of blocked nodes only, same layout order as currentStageNames. */
  blockedNodeNames: string[];
  /** Every open_items row for this project, including closed and cancelled. */
  openItems: CommercialOpenItemRead[];
};

export type CommercialProjectListResponse = {
  items: CommercialProjectListItem[];
  /** Total rows matching the query before limit/offset. */
  total: number;
  limit: number | null;
  offset: number;
};

export type CommercialPublishStatus = {
  published: boolean;
  bvid: string | null;
  publishedAt: string | null;
  publishSource: PublishSource | null;
  /** Stored publish idempotency key. Present only after a record exists, so a later complete can reuse it. */
  idempotencyKey: string | null;
};

export type CommercialProjectDetail = CommercialProjectListItem & {
  publish: CommercialPublishStatus;
};

export type CommercialWorkflowNode = {
  id: string;
  name: string;
  status: WfNodeStatus;
  kind: WfNodeKind;
  /** Template slug when the row was copied from a template node. Null for ad-hoc nodes. */
  templateSlug: string | null;
  /** Open blocking item title for this node, or null when it is not blocked or has no reason. */
  blockingReason: string | null;
  /**
   * Plan instant. User-entered dates are stored as Asia/Shanghai start-of-day.
   * That midnight is a calendar date, not an agreed 00:00 appointment.
   * Null when the node has no plan.
   */
  plannedAt: string | null;
  /** Actual completion instant. Written only by status completion. Null until then. */
  completedAt: string | null;
  /** Concurrency token. Clients send this value back unchanged as expectedUpdatedAt. */
  updatedAt: string;
};

export type CommercialWorkflowEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type CommercialProjectWorkflow = {
  projectId: string;
  workflowId: string;
  templateVersionId: string;
  nodes: CommercialWorkflowNode[];
  edges: CommercialWorkflowEdge[];
};

export type CommercialTemplateNode = {
  id: string;
  slug: string;
  name: string;
  kind: WfNodeKind;
  isOptional: boolean;
};

export type CommercialTemplateEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type CommercialDefaultTemplate = {
  id: string;
  slug: string;
  name: string;
  version: number;
  publishedAt: string;
  nodes: CommercialTemplateNode[];
  edges: CommercialTemplateEdge[];
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

function parseMoney(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) {
    throw new Error(`${label} must be a decimal string or null`);
  }
  return value;
}

function parseStageNames(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => parseName(item, `${label}[${index}]`));
}

function parseNullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string or null`);
  return value;
}

function parseNullableUuid(value: unknown, label: string): string | null {
  if (value === null) return null;
  return parseUuid(value, label);
}

function parseBlockingReason(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('blockingReason must be a non-empty string or null');
  }
  return value;
}

function parseSortRank(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('sortRank must be an integer');
  }
  return value;
}

function parseOpenItem(value: unknown): CommercialOpenItemRead {
  const record = asRecord(value, 'open item');
  if (!isOpenItemActor(record.nextActor)) throw new Error('open item nextActor is invalid');
  if (!isOpenItemLifecycle(record.lifecycle)) throw new Error('open item lifecycle is invalid');
  if (!isOpenItemImpact(record.impact)) throw new Error('open item impact is invalid');
  if (typeof record.blocksRequiredForClose !== 'boolean') {
    throw new Error('blocksRequiredForClose must be a boolean');
  }
  return {
    id: parseUuid(record.id, 'open item id'),
    title: parseName(record.title, 'open item title'),
    description: parseNullableText(record.description, 'description'),
    closeCriteria: parseNullableText(record.closeCriteria, 'closeCriteria'),
    nextAction: parseNullableText(record.nextAction, 'nextAction'),
    nextActor: record.nextActor,
    lifecycle: record.lifecycle,
    impact: record.impact,
    plannedAt: parseNullableIso(record.plannedAt, 'plannedAt'),
    sortRank: parseSortRank(record.sortRank),
    blocksRequiredForClose: record.blocksRequiredForClose,
    workflowNodeId: parseNullableUuid(record.workflowNodeId, 'workflowNodeId'),
    blocksNodeId: parseNullableUuid(record.blocksNodeId, 'blocksNodeId'),
    createdAt: parseIso(record.createdAt, 'createdAt'),
    updatedAt: parseIso(record.updatedAt, 'updatedAt'),
  };
}

function parseOpenItems(value: unknown): CommercialOpenItemRead[] {
  if (!Array.isArray(value)) throw new Error('openItems must be an array');
  return value.map((item) => parseOpenItem(item));
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

function parsePublish(value: unknown): CommercialPublishStatus {
  const record = asRecord(value, 'publish');
  if (typeof record.published !== 'boolean') throw new Error('publish.published must be a boolean');
  if (record.published) {
    if (typeof record.bvid !== 'string' || record.bvid.length === 0) {
      throw new Error('publish.bvid must be a non-empty string when published');
    }
    if (!isPublishSource(record.publishSource)) {
      throw new Error('publish.publishSource is invalid');
    }
    return {
      published: true,
      bvid: record.bvid,
      publishedAt: parseIso(record.publishedAt, 'publish.publishedAt'),
      publishSource: record.publishSource,
      idempotencyKey: parseName(record.idempotencyKey, 'publish.idempotencyKey'),
    };
  }
  if (record.bvid !== null || record.publishedAt !== null || record.publishSource !== null) {
    throw new Error('unpublished publish status must null bvid, publishedAt, and publishSource');
  }
  if (record.idempotencyKey !== undefined && record.idempotencyKey !== null) {
    throw new Error('unpublished publish status must null idempotencyKey');
  }
  return {
    published: false,
    bvid: null,
    publishedAt: null,
    publishSource: null,
    idempotencyKey: null,
  };
}

function parseOriginKind(value: unknown): CommercialOriginKind | null {
  if (value === null) return null;
  if (!isCommercialOriginKind(value)) throw new Error('originKind is invalid');
  return value;
}

function parseSourceSummary(value: unknown): CommercialProjectSourceSummary | null {
  if (value === null) return null;
  const record = asRecord(value, 'source');
  if (typeof record.contentHash !== 'string' || record.contentHash.length === 0) {
    throw new Error('source.contentHash must be a non-empty string');
  }
  return {
    namespace: parseName(record.namespace, 'source.namespace'),
    sourceId: parseName(record.sourceId, 'source.sourceId'),
    sourceUpdatedAt: parseIso(record.sourceUpdatedAt, 'source.sourceUpdatedAt'),
    importedAt: parseIso(record.importedAt, 'source.importedAt'),
    contentHash: record.contentHash,
    sourceStatus: parseNullableText(record.sourceStatus, 'source.sourceStatus'),
    sourceNotes: parseNullableText(record.sourceNotes, 'source.sourceNotes'),
  };
}

function parseListItem(value: unknown): CommercialProjectListItem {
  const record = asRecord(value, 'project list item');
  if (!isOverallStage(record.overallStage)) throw new Error('overallStage is invalid');
  if (typeof record.anyNodeBlocked !== 'boolean') {
    throw new Error('anyNodeBlocked must be a boolean');
  }
  return {
    id: parseUuid(record.id, 'id'),
    name: parseName(record.name, 'name'),
    netAmount: parseMoney(record.netAmount, 'netAmount'),
    rebateAmount: parseMoney(record.rebateAmount, 'rebateAmount'),
    overallStage: record.overallStage,
    currentStageNames: parseStageNames(record.currentStageNames, 'currentStageNames'),
    anyNodeBlocked: record.anyNodeBlocked,
    blockingReason: parseBlockingReason(record.blockingReason),
    createdAt: parseIso(record.createdAt, 'createdAt'),
    updatedAt: parseIso(record.updatedAt, 'updatedAt'),
    userDeadlineAt: parseNullableIso(record.userDeadlineAt, 'userDeadlineAt'),
    blockedSinceAt: parseNullableIso(record.blockedSinceAt, 'blockedSinceAt'),
    archivedAt: parseNullableIso(record.archivedAt, 'archivedAt'),
    stageEnteredAt: parseIso(record.stageEnteredAt, 'stageEnteredAt'),
    businessClosedAt: parseNullableIso(record.businessClosedAt, 'businessClosedAt'),
    originKind: parseOriginKind(record.originKind),
    source: parseSourceSummary(record.source),
    blockedNodeNames: parseStageNames(record.blockedNodeNames, 'blockedNodeNames'),
    openItems: parseOpenItems(record.openItems),
  };
}

function parseLimit(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('limit must be a non-negative integer or null');
  }
  return value;
}

function parseNonNegativeInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

export function parseCommercialProjectList(value: unknown): CommercialProjectListResponse {
  const record = asRecord(value, 'project list');
  if (!Array.isArray(record.items)) throw new Error('items must be an array');
  return {
    items: record.items.map((item) => parseListItem(item)),
    total: parseNonNegativeInt(record.total, 'total'),
    limit: parseLimit(record.limit),
    offset: parseNonNegativeInt(record.offset, 'offset'),
  };
}

export function parseCommercialProjectDetail(value: unknown): CommercialProjectDetail {
  const record = asRecord(value, 'project detail');
  return {
    ...parseListItem(record),
    publish: parsePublish(record.publish),
  };
}

function parseOptionalSlug(value: unknown): string | null {
  if (value == null) return null;
  return parseName(value, 'templateSlug');
}

function parseNodeBlockingReason(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('blockingReason must be a non-empty string or null');
  }
  return value;
}

function parseWorkflowNode(value: unknown): CommercialWorkflowNode {
  const record = asRecord(value, 'workflow node');
  if (!isWfNodeStatus(record.status)) throw new Error('node status is invalid');
  if (!isWfNodeKind(record.kind)) throw new Error('node kind is invalid');
  return {
    id: parseUuid(record.id, 'node id'),
    name: parseName(record.name, 'node name'),
    status: record.status,
    kind: record.kind,
    templateSlug: parseOptionalSlug(record.templateSlug),
    blockingReason: parseNodeBlockingReason(record.blockingReason),
    plannedAt: parseNullableIso(record.plannedAt, 'plannedAt'),
    completedAt: parseNullableIso(record.completedAt, 'completedAt'),
    updatedAt: parseIso(record.updatedAt, 'updatedAt'),
  };
}

function parseWorkflowEdge(value: unknown): CommercialWorkflowEdge {
  const record = asRecord(value, 'workflow edge');
  return {
    id: parseUuid(record.id, 'edge id'),
    fromNodeId: parseUuid(record.fromNodeId, 'fromNodeId'),
    toNodeId: parseUuid(record.toNodeId, 'toNodeId'),
  };
}

export function parseCommercialProjectWorkflow(value: unknown): CommercialProjectWorkflow {
  const record = asRecord(value, 'project workflow');
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    throw new Error('workflow nodes and edges must be arrays');
  }
  return {
    projectId: parseUuid(record.projectId, 'projectId'),
    workflowId: parseUuid(record.workflowId, 'workflowId'),
    templateVersionId: parseUuid(record.templateVersionId, 'templateVersionId'),
    nodes: record.nodes.map((node) => parseWorkflowNode(node)),
    edges: record.edges.map((edge) => parseWorkflowEdge(edge)),
  };
}

function parseTemplateNode(value: unknown): CommercialTemplateNode {
  const record = asRecord(value, 'template node');
  if (!isWfNodeKind(record.kind)) throw new Error('template node kind is invalid');
  if (typeof record.isOptional !== 'boolean') throw new Error('isOptional must be a boolean');
  return {
    id: parseUuid(record.id, 'template node id'),
    slug: parseName(record.slug, 'slug'),
    name: parseName(record.name, 'template node name'),
    kind: record.kind,
    isOptional: record.isOptional,
  };
}

function parseTemplateEdge(value: unknown): CommercialTemplateEdge {
  const record = asRecord(value, 'template edge');
  return {
    id: parseUuid(record.id, 'template edge id'),
    fromNodeId: parseUuid(record.fromNodeId, 'fromNodeId'),
    toNodeId: parseUuid(record.toNodeId, 'toNodeId'),
  };
}

export function parseCommercialDefaultTemplate(value: unknown): CommercialDefaultTemplate {
  const record = asRecord(value, 'default template');
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    throw new Error('template nodes and edges must be arrays');
  }
  if (
    typeof record.version !== 'number' ||
    !Number.isInteger(record.version) ||
    record.version < 1
  ) {
    throw new Error('version must be a positive integer');
  }
  return {
    id: parseUuid(record.id, 'template id'),
    slug: parseName(record.slug, 'slug'),
    name: parseName(record.name, 'template name'),
    version: record.version,
    publishedAt: parseIso(record.publishedAt, 'publishedAt'),
    nodes: record.nodes.map((node) => parseTemplateNode(node)),
    edges: record.edges.map((edge) => parseTemplateEdge(edge)),
  };
}
