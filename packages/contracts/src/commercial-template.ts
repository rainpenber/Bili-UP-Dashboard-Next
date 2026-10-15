/** Default-flow template draft/publish and create-project contracts (WP-004R2-3B2). */

import { isUuidString, isWfNodeKind, type WfNodeKind } from './commercial';

export const TEMPLATE_WRITE_ERROR_CODES = [
  'invalid_body',
  'not_found',
  'immutable',
  'duplicate_name',
  'cycle',
  'self_loop',
  'duplicate_edge',
  'missing_edge',
  'constraint_violation',
] as const;

export type TemplateWriteErrorCode = (typeof TEMPLATE_WRITE_ERROR_CODES)[number];

export type TemplateWriteErrorBody = {
  error: string;
  code: TemplateWriteErrorCode;
};

export type TemplateGraphNode = {
  id: string;
  slug: string;
  name: string;
  kind: WfNodeKind;
  isOptional: boolean;
  posX: number;
  posY: number;
  packageId: string | null;
};

export type TemplateGraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type TemplateVersionGraph = {
  id: string;
  slug: string;
  name: string;
  version: number;
  isDraft: boolean;
  isDefault: boolean;
  publishedAt: string | null;
  nodes: TemplateGraphNode[];
  edges: TemplateGraphEdge[];
};

export type DefaultTemplateWorkspace = {
  slug: string;
  draft: TemplateVersionGraph | null;
  /** Published versions, newest version number first. */
  published: TemplateVersionGraph[];
};

export type AddTemplateNodeRequest = {
  name: string;
  kind: WfNodeKind;
  isOptional: boolean;
  posX: number;
  posY: number;
};

export type RenameTemplateNodeRequest = {
  name: string;
};

export type AddTemplateEdgeRequest = {
  fromNodeId: string;
  toNodeId: string;
};

export type DisconnectTemplateEdgeRequest = {
  fromNodeId: string;
  toNodeId: string;
};

export type CreateProjectFromTemplateRequest = {
  name: string;
  templateVersionId: string;
};

export type CreatedCommercialProject = {
  id: string;
  name: string;
  workflowId: string;
  templateVersionId: string;
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

function parseRequiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function parseNodeName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('节点名称不能为空。');
  }
  return value.trim();
}

function parseProjectName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('项目名称不能为空。');
  }
  return value.trim();
}

function parseIso(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date string`);
  }
  return value;
}

function parseFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function parseVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('version must be a positive integer');
  }
  return value;
}

function isTemplateErrorCode(value: unknown): value is TemplateWriteErrorCode {
  return (
    typeof value === 'string' && (TEMPLATE_WRITE_ERROR_CODES as readonly string[]).includes(value)
  );
}

function parseTemplateNode(value: unknown): TemplateGraphNode {
  const record = asRecord(value, 'template node');
  if (!isWfNodeKind(record.kind)) throw new Error('template node kind is invalid');
  if (typeof record.isOptional !== 'boolean') throw new Error('isOptional must be a boolean');
  const packageId = record.packageId === null ? null : parseUuid(record.packageId, 'packageId');
  return {
    id: parseUuid(record.id, 'template node id'),
    slug: parseRequiredText(record.slug, 'slug'),
    name: parseRequiredText(record.name, 'template node name'),
    kind: record.kind,
    isOptional: record.isOptional,
    posX: parseFinite(record.posX, 'posX'),
    posY: parseFinite(record.posY, 'posY'),
    packageId,
  };
}

function parseTemplateEdge(value: unknown): TemplateGraphEdge {
  const record = asRecord(value, 'template edge');
  return {
    id: parseUuid(record.id, 'template edge id'),
    fromNodeId: parseUuid(record.fromNodeId, 'fromNodeId'),
    toNodeId: parseUuid(record.toNodeId, 'toNodeId'),
  };
}

export function parseTemplateVersionGraph(value: unknown): TemplateVersionGraph {
  const record = asRecord(value, 'template version');
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    throw new Error('template nodes and edges must be arrays');
  }
  if (typeof record.isDraft !== 'boolean') throw new Error('isDraft must be a boolean');
  if (typeof record.isDefault !== 'boolean') throw new Error('isDefault must be a boolean');
  let publishedAt: string | null;
  if (record.isDraft) {
    if (record.publishedAt !== null) throw new Error('draft publishedAt must be null');
    publishedAt = null;
  } else {
    publishedAt = parseIso(record.publishedAt, 'publishedAt');
  }
  return {
    id: parseUuid(record.id, 'template id'),
    slug: parseRequiredText(record.slug, 'slug'),
    name: parseRequiredText(record.name, 'template name'),
    version: parseVersion(record.version),
    isDraft: record.isDraft,
    isDefault: record.isDefault,
    publishedAt,
    nodes: record.nodes.map((node) => parseTemplateNode(node)),
    edges: record.edges.map((edge) => parseTemplateEdge(edge)),
  };
}

export function parseDefaultTemplateWorkspace(value: unknown): DefaultTemplateWorkspace {
  const record = asRecord(value, 'template workspace');
  if (!Array.isArray(record.published)) throw new Error('published must be an array');
  const draft = record.draft === null ? null : parseTemplateVersionGraph(record.draft);
  if (draft && !draft.isDraft) throw new Error('workspace draft must be a draft version');
  const published = record.published.map((item) => parseTemplateVersionGraph(item));
  if (published.some((item) => item.isDraft)) {
    throw new Error('workspace published entries must not be drafts');
  }
  return {
    slug: parseRequiredText(record.slug, 'slug'),
    draft,
    published,
  };
}

export function parseAddTemplateNodeRequest(value: unknown): AddTemplateNodeRequest {
  const record = asRecord(value, 'add template node');
  if (!isWfNodeKind(record.kind)) throw new Error('节点种类只能是 stage 或 merge');
  if (typeof record.isOptional !== 'boolean') throw new Error('isOptional must be a boolean');
  return {
    name: parseNodeName(record.name),
    kind: record.kind,
    isOptional: record.isOptional,
    posX: parseFinite(record.posX, 'posX'),
    posY: parseFinite(record.posY, 'posY'),
  };
}

export function parseRenameTemplateNodeRequest(value: unknown): RenameTemplateNodeRequest {
  const record = asRecord(value, 'rename template node');
  return { name: parseNodeName(record.name) };
}

export function parseAddTemplateEdgeRequest(value: unknown): AddTemplateEdgeRequest {
  const record = asRecord(value, 'add template edge');
  return {
    fromNodeId: parseUuid(record.fromNodeId, 'fromNodeId'),
    toNodeId: parseUuid(record.toNodeId, 'toNodeId'),
  };
}

export function parseDisconnectTemplateEdgeRequest(value: unknown): DisconnectTemplateEdgeRequest {
  const record = asRecord(value, 'disconnect template edge');
  return {
    fromNodeId: parseUuid(record.fromNodeId, 'fromNodeId'),
    toNodeId: parseUuid(record.toNodeId, 'toNodeId'),
  };
}

export function parseCreateProjectFromTemplateRequest(
  value: unknown,
): CreateProjectFromTemplateRequest {
  const record = asRecord(value, 'create project');
  return {
    name: parseProjectName(record.name),
    templateVersionId: parseUuid(record.templateVersionId, 'templateVersionId'),
  };
}

export function parseCreatedCommercialProject(value: unknown): CreatedCommercialProject {
  const record = asRecord(value, 'created project');
  return {
    id: parseUuid(record.id, 'id'),
    name: parseRequiredText(record.name, 'name'),
    workflowId: parseUuid(record.workflowId, 'workflowId'),
    templateVersionId: parseUuid(record.templateVersionId, 'templateVersionId'),
  };
}

export function parseTemplateWriteError(value: unknown): TemplateWriteErrorBody {
  const record = asRecord(value, 'template write error');
  if (!isTemplateErrorCode(record.code)) throw new Error('error code is invalid');
  return {
    error: parseRequiredText(record.error, 'error'),
    code: record.code,
  };
}
