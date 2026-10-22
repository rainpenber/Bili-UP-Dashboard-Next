/** Commercial source ingress contracts (WP-R2-19A). Snapshot + upsert only; no status inference. */

import { isCommercialOriginKind, isUuidString, type CommercialOriginKind } from './commercial';

export type { CommercialOriginKind } from './commercial';
export { isCommercialOriginKind, COMMERCIAL_ORIGIN_KINDS } from './commercial';

export const COMMERCIAL_INGRESS_ERROR_CODES = [
  'invalid_body',
  'duplicate_source_key',
  'batch_too_large',
  'default_template_missing',
  'stale_source_version',
  'same_version_content_conflict',
  'stale_write',
  'expected_updated_at_required',
  'not_found',
  'constraint_violation',
] as const;
export type CommercialIngressErrorCode = (typeof COMMERCIAL_INGRESS_ERROR_CODES)[number];

export const COMMERCIAL_INGRESS_BATCH_MAX = 100;

export type CommercialSourceKey = {
  namespace: string;
  sourceId: string;
};

export type CommercialIngressUpsertItem = {
  sourceKey: CommercialSourceKey;
  originKind: CommercialOriginKind;
  /** External source version clock. Older values cannot overwrite newer. */
  sourceUpdatedAt: string;
  name: string;
  /** Precise decimal text, or null when unknown. Never coerced to 0. */
  netAmount: string | null;
  rebateAmount: string | null;
  /** Raw source status fact. Never used to advance workflow nodes. */
  sourceStatus: string | null;
  sourceNotes: string | null;
  /** Normalized payload object (JSONB object, not a pre-stringified blob). */
  payload: Record<string, unknown>;
  /** Source evidence object. */
  evidence: Record<string, unknown>;
  /**
   * Required when updating an already-linked project.
   * Must match commercial_projects.updated_at from the last read.
   */
  expectedUpdatedAt?: string;
};

export type CommercialIngressUpsertRequest = {
  item: CommercialIngressUpsertItem;
  dryRun?: boolean;
};

export type CommercialIngressBatchRequest = {
  items: CommercialIngressUpsertItem[];
  dryRun?: boolean;
};

export type CommercialIngressOutcome =
  | 'created'
  | 'updated'
  | 'idempotent_replay'
  | 'would_create'
  | 'would_update'
  | 'would_idempotent_replay';

export type CommercialSourceSnapshot = {
  namespace: string;
  sourceId: string;
  originKind: CommercialOriginKind;
  sourceUpdatedAt: string;
  importedAt: string;
  contentHash: string;
  sourceStatus: string | null;
  sourceNotes: string | null;
  payload: Record<string, unknown>;
  evidence: Record<string, unknown>;
};

export type CommercialIngressItemResult = {
  sourceKey: CommercialSourceKey;
  outcome: CommercialIngressOutcome;
  projectId: string | null;
  workflowId: string | null;
  projectUpdatedAt: string | null;
  contentHash: string;
  dryRun: boolean;
};

export type CommercialIngressUpsertResponse = {
  result: CommercialIngressItemResult;
};

export type CommercialIngressBatchResponse = {
  results: CommercialIngressItemResult[];
  dryRun: boolean;
};

export type CommercialIngressErrorBody = {
  error: string;
  code: CommercialIngressErrorCode;
  /** Offending source keys when the batch refuses as a whole. */
  sourceKeys?: CommercialSourceKey[];
};

export type CommercialSourceLookupResponse = {
  projectId: string;
  projectUpdatedAt: string;
  originKind: CommercialOriginKind;
  source: CommercialSourceSnapshot;
};

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const MAX_NAMESPACE = 128;
const MAX_SOURCE_ID = 256;
const MAX_NAME = 512;
const MAX_TEXT = 4000;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseIso(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date string`);
  }
  return value;
}

function parseName(value: unknown, label: string, max = MAX_NAME): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.length > max) throw new Error(`${label} is too long`);
  return value;
}

function parseNullableText(value: unknown, label: string, max = MAX_TEXT): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string or null`);
  if (value.length > max) throw new Error(`${label} is too long`);
  return value;
}

function parseMoney(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) {
    throw new Error(`${label} must be a decimal string or null`);
  }
  return value;
}

function parseJsonObject(value: unknown, label: string): Record<string, unknown> {
  return asRecord(value, label);
}

function isIngressErrorCode(value: unknown): value is CommercialIngressErrorCode {
  return (
    typeof value === 'string' &&
    (COMMERCIAL_INGRESS_ERROR_CODES as readonly string[]).includes(value)
  );
}

export function parseCommercialSourceKey(value: unknown): CommercialSourceKey {
  const record = asRecord(value, 'sourceKey');
  const namespace = parseName(record.namespace, 'namespace', MAX_NAMESPACE);
  const sourceId = parseName(record.sourceId, 'sourceId', MAX_SOURCE_ID);
  if (namespace.includes('/')) throw new Error('namespace must not contain /');
  return { namespace, sourceId };
}

export function parseCommercialIngressUpsertItem(value: unknown): CommercialIngressUpsertItem {
  const record = asRecord(value, 'ingress item');
  if (!isCommercialOriginKind(record.originKind)) {
    throw new Error('originKind must be real, fixture, or manual');
  }
  const item: CommercialIngressUpsertItem = {
    sourceKey: parseCommercialSourceKey(record.sourceKey),
    originKind: record.originKind,
    sourceUpdatedAt: parseIso(record.sourceUpdatedAt, 'sourceUpdatedAt'),
    name: parseName(record.name, 'name'),
    netAmount: parseMoney(record.netAmount, 'netAmount'),
    rebateAmount: parseMoney(record.rebateAmount, 'rebateAmount'),
    sourceStatus: parseNullableText(record.sourceStatus, 'sourceStatus'),
    sourceNotes: parseNullableText(record.sourceNotes, 'sourceNotes'),
    payload: parseJsonObject(record.payload, 'payload'),
    evidence: parseJsonObject(record.evidence, 'evidence'),
  };
  if (record.expectedUpdatedAt !== undefined) {
    item.expectedUpdatedAt = parseIso(record.expectedUpdatedAt, 'expectedUpdatedAt');
  }
  return item;
}

function parseDryRun(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw new Error('dryRun must be a boolean');
  return value;
}

export function parseCommercialIngressUpsertRequest(
  value: unknown,
): CommercialIngressUpsertRequest {
  const record = asRecord(value, 'ingress upsert');
  return {
    item: parseCommercialIngressUpsertItem(record.item),
    dryRun: parseDryRun(record.dryRun),
  };
}

export function parseCommercialIngressBatchRequest(value: unknown): CommercialIngressBatchRequest {
  const record = asRecord(value, 'ingress batch');
  if (!Array.isArray(record.items)) throw new Error('items must be an array');
  if (record.items.length === 0) throw new Error('items must not be empty');
  if (record.items.length > COMMERCIAL_INGRESS_BATCH_MAX) {
    throw new Error(`items must not exceed ${COMMERCIAL_INGRESS_BATCH_MAX}`);
  }
  return {
    items: record.items.map((item, index) => {
      try {
        return parseCommercialIngressUpsertItem(item);
      } catch (err) {
        throw new Error(`items[${index}]: ${err instanceof Error ? err.message : 'invalid item'}`);
      }
    }),
    dryRun: parseDryRun(record.dryRun),
  };
}

function parseOutcome(value: unknown): CommercialIngressOutcome {
  if (
    value === 'created' ||
    value === 'updated' ||
    value === 'idempotent_replay' ||
    value === 'would_create' ||
    value === 'would_update' ||
    value === 'would_idempotent_replay'
  ) {
    return value;
  }
  throw new Error('outcome is invalid');
}

function parseNullableUuid(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (!isUuidString(value)) throw new Error(`${label} must be a uuid or null`);
  return value;
}

function parseNullableIso(value: unknown, label: string): string | null {
  if (value === null) return null;
  return parseIso(value, label);
}

export function parseCommercialIngressItemResult(value: unknown): CommercialIngressItemResult {
  const record = asRecord(value, 'ingress result');
  if (typeof record.dryRun !== 'boolean') throw new Error('dryRun must be a boolean');
  if (typeof record.contentHash !== 'string' || record.contentHash.length === 0) {
    throw new Error('contentHash must be a non-empty string');
  }
  return {
    sourceKey: parseCommercialSourceKey(record.sourceKey),
    outcome: parseOutcome(record.outcome),
    projectId: parseNullableUuid(record.projectId, 'projectId'),
    workflowId: parseNullableUuid(record.workflowId, 'workflowId'),
    projectUpdatedAt: parseNullableIso(record.projectUpdatedAt, 'projectUpdatedAt'),
    contentHash: record.contentHash,
    dryRun: record.dryRun,
  };
}

export function parseCommercialIngressUpsertResponse(
  value: unknown,
): CommercialIngressUpsertResponse {
  const record = asRecord(value, 'ingress upsert response');
  return { result: parseCommercialIngressItemResult(record.result) };
}

export function parseCommercialIngressBatchResponse(
  value: unknown,
): CommercialIngressBatchResponse {
  const record = asRecord(value, 'ingress batch response');
  if (!Array.isArray(record.results)) throw new Error('results must be an array');
  if (typeof record.dryRun !== 'boolean') throw new Error('dryRun must be a boolean');
  return {
    results: record.results.map((item) => parseCommercialIngressItemResult(item)),
    dryRun: record.dryRun,
  };
}

export function parseCommercialIngressError(value: unknown): CommercialIngressErrorBody {
  const record = asRecord(value, 'ingress error');
  if (!isIngressErrorCode(record.code)) throw new Error('error code is invalid');
  const body: CommercialIngressErrorBody = {
    error: parseName(record.error, 'error'),
    code: record.code,
  };
  if (record.sourceKeys !== undefined) {
    if (!Array.isArray(record.sourceKeys)) throw new Error('sourceKeys must be an array');
    body.sourceKeys = record.sourceKeys.map((item) => parseCommercialSourceKey(item));
  }
  return body;
}

function parseSnapshot(value: unknown): CommercialSourceSnapshot {
  const record = asRecord(value, 'source snapshot');
  if (!isCommercialOriginKind(record.originKind)) throw new Error('originKind is invalid');
  if (typeof record.contentHash !== 'string' || record.contentHash.length === 0) {
    throw new Error('contentHash must be a non-empty string');
  }
  return {
    namespace: parseName(record.namespace, 'namespace', MAX_NAMESPACE),
    sourceId: parseName(record.sourceId, 'sourceId', MAX_SOURCE_ID),
    originKind: record.originKind,
    sourceUpdatedAt: parseIso(record.sourceUpdatedAt, 'sourceUpdatedAt'),
    importedAt: parseIso(record.importedAt, 'importedAt'),
    contentHash: record.contentHash,
    sourceStatus: parseNullableText(record.sourceStatus, 'sourceStatus'),
    sourceNotes: parseNullableText(record.sourceNotes, 'sourceNotes'),
    payload: parseJsonObject(record.payload, 'payload'),
    evidence: parseJsonObject(record.evidence, 'evidence'),
  };
}

export function parseCommercialSourceLookupResponse(
  value: unknown,
): CommercialSourceLookupResponse {
  const record = asRecord(value, 'source lookup');
  if (!isCommercialOriginKind(record.originKind)) throw new Error('originKind is invalid');
  if (!isUuidString(record.projectId)) throw new Error('projectId must be a uuid');
  return {
    projectId: record.projectId,
    projectUpdatedAt: parseIso(record.projectUpdatedAt, 'projectUpdatedAt'),
    originKind: record.originKind,
    source: parseSnapshot(record.source),
  };
}
