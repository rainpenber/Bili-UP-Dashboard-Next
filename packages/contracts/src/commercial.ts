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
};

export type CommercialProjectListResponse = {
  items: CommercialProjectListItem[];
};

export type CommercialPublishStatus = {
  published: boolean;
  bvid: string | null;
  publishedAt: string | null;
  publishSource: PublishSource | null;
};

export type CommercialProjectDetail = {
  id: string;
  name: string;
  netAmount: string | null;
  rebateAmount: string | null;
  overallStage: OverallStage;
  currentStageNames: string[];
  anyNodeBlocked: boolean;
  /** Title of the chosen open blocking item, or null when the block has no reason. */
  blockingReason: string | null;
  publish: CommercialPublishStatus;
};

export type CommercialWorkflowNode = {
  id: string;
  name: string;
  status: WfNodeStatus;
  kind: WfNodeKind;
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

function parseStageNames(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('currentStageNames must be an array');
  return value.map((item, index) => parseName(item, `currentStageNames[${index}]`));
}

function parseIso(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date string`);
  }
  return value;
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
    };
  }
  if (record.bvid !== null || record.publishedAt !== null || record.publishSource !== null) {
    throw new Error('unpublished publish status must null bvid, publishedAt, and publishSource');
  }
  return { published: false, bvid: null, publishedAt: null, publishSource: null };
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
    currentStageNames: parseStageNames(record.currentStageNames),
    anyNodeBlocked: record.anyNodeBlocked,
  };
}

export function parseCommercialProjectList(value: unknown): CommercialProjectListResponse {
  const record = asRecord(value, 'project list');
  if (!Array.isArray(record.items)) throw new Error('items must be an array');
  return { items: record.items.map((item) => parseListItem(item)) };
}

export function parseCommercialProjectDetail(value: unknown): CommercialProjectDetail {
  const record = asRecord(value, 'project detail');
  const item = parseListItem(record);
  if (record.blockingReason !== null && typeof record.blockingReason !== 'string') {
    throw new Error('blockingReason must be a string or null');
  }
  if (typeof record.blockingReason === 'string' && record.blockingReason.trim().length === 0) {
    throw new Error('blockingReason must be non-empty when present');
  }
  return {
    ...item,
    blockingReason: record.blockingReason,
    publish: parsePublish(record.publish),
  };
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
