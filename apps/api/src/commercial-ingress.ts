import {
  COMMERCIAL_INGRESS_BATCH_MAX,
  parseCommercialIngressBatchRequest,
  parseCommercialIngressBatchResponse,
  parseCommercialIngressError,
  parseCommercialIngressUpsertRequest,
  parseCommercialIngressUpsertResponse,
  parseCommercialSourceLookupResponse,
  type CommercialIngressBatchResponse,
  type CommercialIngressErrorBody,
  type CommercialIngressErrorCode,
  type CommercialIngressItemResult,
  type CommercialIngressOutcome,
  type CommercialIngressUpsertItem,
  type CommercialIngressUpsertResponse,
  type CommercialSourceKey,
  type CommercialSourceLookupResponse,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import {
  commercialIngressContentHash,
  instantiateDefaultWorkflow,
  loadPublishedDefaultTemplate,
  sourceAdvisoryLockKeys,
  type CommercialIngressSql,
} from '@studio/db';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import postgres from 'postgres';
import { COMMERCIAL_UPDATED_AT_FORMAT } from './commercial-timestamp';

type Tx = postgres.TransactionSql;

class IngressRefusal extends Error {
  readonly status: 400 | 404 | 409;
  readonly body: CommercialIngressErrorBody;

  constructor(
    status: 400 | 404 | 409,
    code: CommercialIngressErrorCode,
    error: string,
    sourceKeys?: CommercialSourceKey[],
  ) {
    super(error);
    this.status = status;
    const body: CommercialIngressErrorBody = { error, code };
    if (sourceKeys && sourceKeys.length > 0) body.sourceKeys = sourceKeys;
    this.body = body;
  }
}

function refuse(
  status: 400 | 404 | 409,
  code: CommercialIngressErrorCode,
  error: string,
  sourceKeys?: CommercialSourceKey[],
): never {
  throw new IngressRefusal(status, code, error, sourceKeys);
}

function compareIso(a: string, b: string): number {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isNaN(left) || Number.isNaN(right)) {
    refuse(400, 'invalid_body', 'sourceUpdatedAt 无法比较');
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

function sortKey(item: CommercialIngressUpsertItem): string {
  return `${item.sourceKey.namespace}\0${item.sourceKey.sourceId}`;
}

function assertNoDuplicateKeys(items: CommercialIngressUpsertItem[]): void {
  const seen = new Map<string, CommercialSourceKey>();
  const dupes: CommercialSourceKey[] = [];
  for (const item of items) {
    const key = sortKey(item);
    const prior = seen.get(key);
    if (prior) {
      dupes.push(item.sourceKey);
    } else {
      seen.set(key, item.sourceKey);
    }
  }
  if (dupes.length > 0) {
    refuse(400, 'duplicate_source_key', '同一批次内 sourceKey 不得重复', dupes);
  }
}

type SourceRow = {
  id: string;
  namespace: string;
  source_id: string;
  project_id: string;
  origin_kind: string;
  source_updated_at: string;
  imported_at: string;
  payload: unknown;
  evidence: unknown;
  content_hash: string;
  source_status: string | null;
  source_notes: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  net_amount: string | null;
  rebate_amount: string | null;
  origin_kind: string | null;
  updated_at: string;
};

async function audit(
  tx: Tx,
  projectId: string,
  action: string,
  detail: postgres.JSONValue,
): Promise<void> {
  await tx`
    INSERT INTO domain_audit_events (project_id, entity_type, entity_id, action, detail, source)
    VALUES (${projectId}, 'commercial_project_source', NULL, ${action}, ${tx.json(detail)}, 'ingress')
  `;
}

async function readProjectUpdatedAt(tx: Tx, projectId: string): Promise<string> {
  const rows = await tx<{ updated_at: string }[]>`
    SELECT to_char(updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at
    FROM commercial_projects
    WHERE id = ${projectId}
  `;
  const row = rows[0];
  if (!row) refuse(404, 'not_found', '项目不存在');
  return row.updated_at;
}

async function readWorkflowId(tx: Tx, projectId: string): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM project_workflows WHERE project_id = ${projectId}
  `;
  return rows[0]?.id ?? null;
}

function outcomeFor(
  dryRun: boolean,
  kind: 'created' | 'updated' | 'idempotent_replay',
): CommercialIngressOutcome {
  if (!dryRun) return kind;
  if (kind === 'created') return 'would_create';
  if (kind === 'updated') return 'would_update';
  return 'would_idempotent_replay';
}

async function upsertOne(
  tx: Tx,
  item: CommercialIngressUpsertItem,
  dryRun: boolean,
): Promise<CommercialIngressItemResult> {
  const [k1, k2] = sourceAdvisoryLockKeys(item.sourceKey.namespace, item.sourceKey.sourceId);
  await tx`SELECT pg_advisory_xact_lock(${k1}, ${k2})`;

  const contentHash = commercialIngressContentHash({
    name: item.name,
    netAmount: item.netAmount,
    rebateAmount: item.rebateAmount,
    sourceStatus: item.sourceStatus,
    sourceNotes: item.sourceNotes,
    payload: item.payload,
    evidence: item.evidence,
  });

  const existing = await tx<SourceRow[]>`
    SELECT
      id,
      namespace,
      source_id,
      project_id,
      origin_kind,
      to_char(source_updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS source_updated_at,
      to_char(imported_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS imported_at,
      payload,
      evidence,
      content_hash,
      source_status,
      source_notes
    FROM commercial_project_sources
    WHERE namespace = ${item.sourceKey.namespace}
      AND source_id = ${item.sourceKey.sourceId}
    FOR UPDATE
  `;
  const source = existing[0];

  if (!source) {
    const queryable = tx as unknown as CommercialIngressSql;
    const template = await loadPublishedDefaultTemplate(queryable);
    if (!template) {
      refuse(
        409,
        'default_template_missing',
        '缺少已发布的默认流程模板，拒绝创建（不会偷偷 seed）',
        [item.sourceKey],
      );
    }

    if (dryRun) {
      return {
        sourceKey: item.sourceKey,
        outcome: outcomeFor(true, 'created'),
        projectId: null,
        workflowId: null,
        projectUpdatedAt: null,
        contentHash,
        dryRun: true,
      };
    }

    const projectId = crypto.randomUUID();
    const sourceRowId = crypto.randomUUID();
    await tx`
      INSERT INTO commercial_projects (
        id, name, net_amount, rebate_amount, overall_stage, origin_kind
      ) VALUES (
        ${projectId}, ${item.name}, ${item.netAmount}, ${item.rebateAmount},
        'pre_publish', ${item.originKind}
      )
    `;
    const instantiated = await instantiateDefaultWorkflow(queryable, projectId, template);
    await tx`
      INSERT INTO commercial_project_sources (
        id, namespace, source_id, project_id, origin_kind, source_updated_at,
        payload, evidence, content_hash, source_status, source_notes
      ) VALUES (
        ${sourceRowId},
        ${item.sourceKey.namespace},
        ${item.sourceKey.sourceId},
        ${projectId},
        ${item.originKind},
        ${item.sourceUpdatedAt},
        ${tx.json(item.payload as postgres.JSONValue)},
        ${tx.json(item.evidence as postgres.JSONValue)},
        ${contentHash},
        ${item.sourceStatus},
        ${item.sourceNotes}
      )
    `;
    await audit(tx, projectId, 'ingress_create', {
      namespace: item.sourceKey.namespace,
      sourceId: item.sourceKey.sourceId,
      contentHash,
      sourceUpdatedAt: item.sourceUpdatedAt,
      originKind: item.originKind,
      workflowId: instantiated.workflowId,
      nodeCount: instantiated.nodeCount,
      edgeCount: instantiated.edgeCount,
    } as postgres.JSONValue);
    return {
      sourceKey: item.sourceKey,
      outcome: 'created',
      projectId,
      workflowId: instantiated.workflowId,
      projectUpdatedAt: await readProjectUpdatedAt(tx, projectId),
      contentHash,
      dryRun: false,
    };
  }

  const versionCmp = compareIso(item.sourceUpdatedAt, source.source_updated_at);
  if (versionCmp < 0) {
    refuse(409, 'stale_source_version', '旧源版本不得覆盖较新的已存快照', [item.sourceKey]);
  }
  if (versionCmp === 0) {
    if (source.content_hash === contentHash) {
      const workflowId = await readWorkflowId(tx, source.project_id);
      return {
        sourceKey: item.sourceKey,
        outcome: outcomeFor(dryRun, 'idempotent_replay'),
        projectId: source.project_id,
        workflowId,
        projectUpdatedAt: await readProjectUpdatedAt(tx, source.project_id),
        contentHash,
        dryRun,
      };
    }
    refuse(409, 'same_version_content_conflict', '相同源版本但内容不同，拒绝覆盖', [
      item.sourceKey,
    ]);
  }

  // Newer source version: require local optimistic lock token.
  if (!item.expectedUpdatedAt) {
    refuse(
      409,
      'expected_updated_at_required',
      '更新已绑定项目必须提供 expectedUpdatedAt，禁止无保护覆盖网页手改',
      [item.sourceKey],
    );
  }

  const projects = await tx<ProjectRow[]>`
    SELECT
      id,
      name,
      net_amount::text AS net_amount,
      rebate_amount::text AS rebate_amount,
      origin_kind,
      to_char(updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at
    FROM commercial_projects
    WHERE id = ${source.project_id}
    FOR UPDATE
  `;
  const project = projects[0];
  if (!project) refuse(404, 'not_found', '来源已绑定的项目不存在', [item.sourceKey]);
  if (project.updated_at !== item.expectedUpdatedAt) {
    refuse(409, 'stale_write', '本地乐观锁冲突：expectedUpdatedAt 与项目 updatedAt 不一致', [
      item.sourceKey,
    ]);
  }

  if (dryRun) {
    return {
      sourceKey: item.sourceKey,
      outcome: outcomeFor(true, 'updated'),
      projectId: project.id,
      workflowId: await readWorkflowId(tx, project.id),
      projectUpdatedAt: project.updated_at,
      contentHash,
      dryRun: true,
    };
  }

  await tx`
    UPDATE commercial_projects
    SET
      name = ${item.name},
      net_amount = ${item.netAmount},
      rebate_amount = ${item.rebateAmount},
      origin_kind = ${item.originKind},
      updated_at = now()
    WHERE id = ${project.id}
  `;
  await tx`
    UPDATE commercial_project_sources
    SET
      origin_kind = ${item.originKind},
      source_updated_at = ${item.sourceUpdatedAt},
      imported_at = now(),
      payload = ${tx.json(item.payload as postgres.JSONValue)},
      evidence = ${tx.json(item.evidence as postgres.JSONValue)},
      content_hash = ${contentHash},
      source_status = ${item.sourceStatus},
      source_notes = ${item.sourceNotes},
      updated_at = now()
    WHERE id = ${source.id}
  `;
  await audit(tx, project.id, 'ingress_update', {
    namespace: item.sourceKey.namespace,
    sourceId: item.sourceKey.sourceId,
    contentHash,
    sourceUpdatedAt: item.sourceUpdatedAt,
    previousSourceUpdatedAt: source.source_updated_at,
    previousContentHash: source.content_hash,
    originKind: item.originKind,
  } as postgres.JSONValue);

  return {
    sourceKey: item.sourceKey,
    outcome: 'updated',
    projectId: project.id,
    workflowId: await readWorkflowId(tx, project.id),
    projectUpdatedAt: await readProjectUpdatedAt(tx, project.id),
    contentHash,
    dryRun: false,
  };
}

export async function runCommercialIngressBatch(
  db: Sql,
  items: CommercialIngressUpsertItem[],
  dryRun: boolean,
): Promise<CommercialIngressBatchResponse> {
  if (items.length > COMMERCIAL_INGRESS_BATCH_MAX) {
    refuse(400, 'batch_too_large', `单批最多 ${COMMERCIAL_INGRESS_BATCH_MAX} 条`);
  }
  assertNoDuplicateKeys(items);
  const ordered = [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  // Shared transactional path for single/batch. dryRun never inserts project/source/audit rows.
  const results = await db.begin(async (tx) => {
    const out: CommercialIngressItemResult[] = [];
    for (const item of ordered) {
      out.push(await upsertOne(tx, item, dryRun));
    }
    return out;
  });
  return { results, dryRun };
}

export async function runCommercialIngressUpsert(
  db: Sql,
  item: CommercialIngressUpsertItem,
  dryRun: boolean,
): Promise<CommercialIngressUpsertResponse> {
  const batch = await runCommercialIngressBatch(db, [item], dryRun);
  const result = batch.results[0];
  if (!result) {
    refuse(409, 'constraint_violation', 'upsert 未返回结果');
  }
  return { result };
}

export async function lookupCommercialSource(
  db: Sql,
  namespace: string,
  sourceId: string,
): Promise<CommercialSourceLookupResponse> {
  const rows = await db<
    {
      project_id: string;
      project_updated_at: string;
      origin_kind: string;
      namespace: string;
      source_id: string;
      source_updated_at: string;
      imported_at: string;
      content_hash: string;
      source_status: string | null;
      source_notes: string | null;
      payload: unknown;
      evidence: unknown;
    }[]
  >`
    SELECT
      s.project_id,
      to_char(p.updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS project_updated_at,
      s.origin_kind,
      s.namespace,
      s.source_id,
      to_char(s.source_updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS source_updated_at,
      to_char(s.imported_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS imported_at,
      s.content_hash,
      s.source_status,
      s.source_notes,
      s.payload,
      s.evidence
    FROM commercial_project_sources s
    JOIN commercial_projects p ON p.id = s.project_id
    WHERE s.namespace = ${namespace} AND s.source_id = ${sourceId}
  `;
  const row = rows[0];
  if (!row) refuse(404, 'not_found', '来源不存在');
  if (
    typeof row.payload !== 'object' ||
    row.payload === null ||
    Array.isArray(row.payload) ||
    typeof row.evidence !== 'object' ||
    row.evidence === null ||
    Array.isArray(row.evidence)
  ) {
    refuse(409, 'constraint_violation', '来源 JSONB 不是 object');
  }
  return parseCommercialSourceLookupResponse({
    projectId: row.project_id,
    projectUpdatedAt: row.project_updated_at,
    originKind: row.origin_kind,
    source: {
      namespace: row.namespace,
      sourceId: row.source_id,
      originKind: row.origin_kind,
      sourceUpdatedAt: row.source_updated_at,
      importedAt: row.imported_at,
      contentHash: row.content_hash,
      sourceStatus: row.source_status,
      sourceNotes: row.source_notes,
      payload: row.payload,
      evidence: row.evidence,
    },
  });
}

async function handleIngressError(c: Context, err: unknown) {
  if (err instanceof IngressRefusal) {
    return c.json(parseCommercialIngressError(err.body), err.status);
  }
  if (err instanceof postgres.PostgresError && err.code === '23505') {
    return c.json(
      parseCommercialIngressError({
        error: err.message,
        code: 'constraint_violation',
      }),
      409,
    );
  }
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
}

export function registerCommercialIngressRoutes(app: Hono, db: Sql): void {
  app.post('/ingress/upsert', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        parseCommercialIngressError({ error: '请求体必须是 JSON', code: 'invalid_body' }),
        400,
      );
    }
    try {
      const request = parseCommercialIngressUpsertRequest(body);
      const response = await runCommercialIngressUpsert(db, request.item, request.dryRun ?? false);
      return c.json(parseCommercialIngressUpsertResponse(response));
    } catch (err) {
      if (
        err instanceof Error &&
        !(err instanceof IngressRefusal) &&
        !(err instanceof postgres.PostgresError)
      ) {
        if (
          err.message.includes('must be') ||
          err.message.includes('invalid') ||
          err.message.includes('too long') ||
          err.message.includes('required')
        ) {
          return c.json(
            parseCommercialIngressError({ error: err.message, code: 'invalid_body' }),
            400,
          );
        }
      }
      return handleIngressError(c, err);
    }
  });

  app.post('/ingress/batch', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        parseCommercialIngressError({ error: '请求体必须是 JSON', code: 'invalid_body' }),
        400,
      );
    }
    try {
      const request = parseCommercialIngressBatchRequest(body);
      const response = await runCommercialIngressBatch(db, request.items, request.dryRun ?? false);
      return c.json(parseCommercialIngressBatchResponse(response));
    } catch (err) {
      if (
        err instanceof Error &&
        !(err instanceof IngressRefusal) &&
        !(err instanceof postgres.PostgresError)
      ) {
        if (
          err.message.includes('must be') ||
          err.message.includes('invalid') ||
          err.message.includes('empty') ||
          err.message.includes('exceed') ||
          err.message.includes('items[')
        ) {
          return c.json(
            parseCommercialIngressError({ error: err.message, code: 'invalid_body' }),
            400,
          );
        }
      }
      return handleIngressError(c, err);
    }
  });

  app.get('/ingress/by-source/:namespace/:sourceId', async (c) => {
    const namespace = c.req.param('namespace');
    const sourceId = c.req.param('sourceId');
    if (!namespace || !sourceId) {
      return c.json(
        parseCommercialIngressError({ error: 'namespace 与 sourceId 必填', code: 'invalid_body' }),
        400,
      );
    }
    try {
      const response = await lookupCommercialSource(db, namespace, sourceId);
      return c.json(response);
    } catch (err) {
      return handleIngressError(c, err);
    }
  });
}
