import { hermesWriteEnvelopeSchema, type HermesWriteEnvelope } from '@studio/contracts';
import type { CommercialEngine } from './engine';
import { canonicalJson } from './canonical-json';
import { hermesPayloadHash } from './canonical-json';
import { applyHermesEnvelopeTx } from './engine-mutations';
import type { Db } from './graph-io';

export async function executeHermesOperation(
  engine: CommercialEngine,
  raw: Record<string, unknown>,
) {
  const envelope = hermesWriteEnvelopeSchema.parse(raw);
  const auto = envelope.autoApply || envelope.confidence >= 0.85;
  if (!auto) {
    return engine.db.begin(async (tx) => insertProposalTx(tx, envelope));
  }
  return engine.db.begin(async (tx) => runDirectWriteTx(engine, tx, envelope));
}

export async function acceptHermesProposal(engine: CommercialEngine, proposalId: string) {
  return engine.db.begin(async (tx) => {
    const rows = await tx<
      {
        id: string;
        idempotency_key: string;
        operation: string;
        payload: unknown;
        project_id: string | null;
        status: string;
        result_json: unknown;
      }[]
    >`
      SELECT id, idempotency_key, operation, payload, project_id, status, result_json
      FROM hermes_write_proposals WHERE id = ${proposalId} FOR UPDATE
    `;
    const row = rows[0];
    if (!row) throw Object.assign(new Error('proposal not found'), { status: 404 });
    if (row.status === 'accepted') {
      const cached = await loadIdempotentResult(tx, row.idempotency_key);
      return { mode: 'accepted', result: cached ?? row.result_json };
    }
    if (row.status === 'rejected')
      throw Object.assign(new Error('proposal rejected'), { status: 409 });
    const envelope = hermesWriteEnvelopeSchema.parse({
      operation: row.operation,
      idempotencyKey: row.idempotency_key,
      payload: row.payload,
      confidence: 1,
      autoApply: true,
    });
    const result = await runDirectWriteTx(engine, tx, envelope, { proposalId: row.id });
    const projectId = effectiveProjectId(envelope, result);
    await tx`
      UPDATE hermes_write_proposals SET status = 'accepted', resolved_at = now(), result_json = ${JSON.stringify(result)}::jsonb,
        project_id = COALESCE(project_id, ${projectId})
      WHERE id = ${proposalId}
    `;
    await auditHermes(tx, projectId, 'hermes_proposal', proposalId, 'accept', { result });
    return { mode: 'accepted', result };
  });
}

export async function rejectHermesProposal(
  engine: CommercialEngine,
  proposalId: string,
  reason: string,
) {
  return engine.db.begin(async (tx) => {
    const rows = await tx<{ id: string; status: string; project_id: string | null }[]>`
      SELECT id, status, project_id FROM hermes_write_proposals WHERE id = ${proposalId} FOR UPDATE
    `;
    const row = rows[0];
    if (!row) throw Object.assign(new Error('proposal not found'), { status: 404 });
    if (row.status !== 'pending')
      throw Object.assign(new Error('proposal not pending'), { status: 409 });
    const updated = await tx`
      UPDATE hermes_write_proposals SET status = 'rejected', rejection_reason = ${reason}, resolved_at = now()
      WHERE id = ${proposalId} AND status = 'pending'
      RETURNING id
    `;
    if (!updated.length) throw Object.assign(new Error('proposal not pending'), { status: 409 });
    await auditHermes(tx, row.project_id, 'hermes_proposal', proposalId, 'reject', { reason });
    return { status: 'rejected' };
  });
}

async function insertProposalTx(tx: Db, envelope: HermesWriteEnvelope) {
  const projectId = resolveProjectId(envelope);
  const existing = await tx<
    { id: string; status: string; operation: string; project_id: string | null; payload: unknown }[]
  >`
    SELECT id, status, operation, project_id, payload FROM hermes_write_proposals WHERE idempotency_key = ${envelope.idempotencyKey}
  `;
  if (existing[0]) {
    assertProposalMatches(envelope, existing[0]);
    return { mode: 'proposal', proposalId: existing[0].id, status: existing[0].status };
  }
  const id = crypto.randomUUID();
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO hermes_write_proposals (id, project_id, idempotency_key, operation, status, payload, source_evidence, confidence)
    VALUES (${id}, ${projectId}, ${envelope.idempotencyKey}, ${envelope.operation}, 'pending', ${JSON.stringify(envelope.payload)}::jsonb, ${envelope.sourceEvidence ? JSON.stringify(envelope.sourceEvidence) : null}::jsonb, ${envelope.confidence})
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `;
  const row = (
    await tx<
      {
        id: string;
        status: string;
        operation: string;
        project_id: string | null;
        payload: unknown;
      }[]
    >`SELECT id, status, operation, project_id, payload FROM hermes_write_proposals WHERE idempotency_key = ${envelope.idempotencyKey}`
  )[0];
  if (!row) throw Object.assign(new Error('proposal insert failed'), { status: 500 });
  if (!inserted[0]) assertProposalMatches(envelope, row);
  return { mode: 'proposal', proposalId: row.id, status: row.status };
}

function assertProposalMatches(
  envelope: HermesWriteEnvelope,
  existing: { operation: string; project_id: string | null; payload: unknown },
) {
  const projectId = resolveProjectId(envelope);
  if (
    existing.operation !== envelope.operation ||
    (existing.project_id ?? null) !== projectId ||
    canonicalJson(existing.payload) !== canonicalJson(envelope.payload)
  ) {
    throw Object.assign(new Error('idempotency key conflict'), { status: 409 });
  }
}

async function runDirectWriteTx(
  engine: CommercialEngine,
  tx: Db,
  envelope: HermesWriteEnvelope,
  opts?: { proposalId?: string },
) {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${envelope.idempotencyKey}))`;
  const projectIdBefore = resolveProjectId(envelope);
  const payloadHash = hermesPayloadHash(envelope.operation, projectIdBefore, envelope.payload);
  const prior = await tx<
    { operation: string; project_id: string | null; payload_hash: string; result_json: unknown }[]
  >`
    SELECT operation, project_id, payload_hash, result_json FROM hermes_idempotency
    WHERE idempotency_key = ${envelope.idempotencyKey} FOR UPDATE
  `;
  if (prior[0]) {
    if (
      prior[0].operation !== envelope.operation ||
      (prior[0].project_id ?? null) !== projectIdBefore ||
      prior[0].payload_hash !== payloadHash
    ) {
      throw Object.assign(new Error('idempotency key conflict'), { status: 409 });
    }
    return prior[0].result_json;
  }
  const result = await applyHermesEnvelopeTx(tx, envelope, (innerTx) =>
    engine.resolveDefaultTemplateVersionId(innerTx),
  );
  const projectIdAfter = effectiveProjectId(envelope, result);
  const storedHash = hermesPayloadHash(
    envelope.operation,
    projectIdAfter ?? projectIdBefore,
    envelope.payload,
  );
  await tx`
    INSERT INTO hermes_idempotency (idempotency_key, operation, project_id, payload_hash, result_json)
    VALUES (${envelope.idempotencyKey}, ${envelope.operation}, ${projectIdAfter ?? projectIdBefore}, ${storedHash}, ${JSON.stringify(result)}::jsonb)
  `;
  if (opts?.proposalId) {
    await tx`
      UPDATE hermes_write_proposals SET result_json = ${JSON.stringify(result)}::jsonb, project_id = COALESCE(project_id, ${projectIdAfter})
      WHERE id = ${opts.proposalId}
    `;
  }
  await auditHermes(tx, projectIdAfter, 'hermes', null, envelope.operation, {
    idempotencyKey: envelope.idempotencyKey,
    payload: envelope.payload,
  });
  return result;
}

async function auditHermes(
  tx: Db,
  projectId: string | null,
  entityType: string,
  entityId: string | null,
  action: string,
  detail: unknown,
) {
  await tx`
    INSERT INTO workflow_audit_log (project_id, entity_type, entity_id, action, detail, source)
    VALUES (${projectId}, ${entityType}, ${entityId}, ${action}, ${JSON.stringify(detail)}::jsonb, 'hermes')
  `;
}

async function loadIdempotentResult(tx: Db, idempotencyKey: string) {
  const rows = await tx<{ result_json: unknown }[]>`
    SELECT result_json FROM hermes_idempotency WHERE idempotency_key = ${idempotencyKey}
  `;
  return rows[0]?.result_json ?? null;
}

function resolveProjectId(envelope: HermesWriteEnvelope): string | null {
  const p = envelope.payload as { projectId?: string };
  return p.projectId ?? null;
}

function effectiveProjectId(envelope: HermesWriteEnvelope, result: unknown): string | null {
  const fromPayload = resolveProjectId(envelope);
  if (fromPayload) return fromPayload;
  if (result && typeof result === 'object' && result !== null && 'projectId' in result) {
    const id = (result as { projectId?: string }).projectId;
    if (typeof id === 'string') return id;
  }
  return null;
}
