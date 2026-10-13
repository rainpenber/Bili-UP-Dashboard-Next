import { createOpenItemBodySchema, hermesWriteBodySchema } from '@studio/contracts';
import type { CommercialEngine } from './engine';
import type { Db } from './graph-io';

export async function executeHermesOperation(
  engine: CommercialEngine,
  raw: Record<string, unknown>,
) {
  const body = hermesWriteBodySchema.parse(raw);
  const auto = body.autoApply || body.confidence >= 0.85;
  if (!auto) {
    return engine.db.begin(async (tx) => {
      const existing = await tx<{ id: string; status: string }[]>`
        SELECT id, status FROM hermes_write_proposals WHERE idempotency_key = ${body.idempotencyKey}
      `;
      if (existing[0]) {
        return { mode: 'proposal', proposalId: existing[0].id, status: existing[0].status };
      }
      const id = crypto.randomUUID();
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO hermes_write_proposals (id, project_id, idempotency_key, operation, status, payload, source_evidence, confidence)
        VALUES (${id}, ${body.projectId ?? null}, ${body.idempotencyKey}, ${body.operation}, 'pending', ${JSON.stringify(body.payload)}::jsonb, ${body.sourceEvidence ? JSON.stringify(body.sourceEvidence) : null}::jsonb, ${body.confidence})
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `;
      const proposalId =
        inserted[0]?.id ??
        (
          await tx<{ id: string; status: string }[]>`
            SELECT id, status FROM hermes_write_proposals WHERE idempotency_key = ${body.idempotencyKey}
          `
        )[0]?.id;
      if (!proposalId) throw Object.assign(new Error('proposal insert failed'), { status: 500 });
      const status =
        inserted[0]?.id != null
          ? 'pending'
          : ((
              await tx<{ status: string }[]>`
                SELECT status FROM hermes_write_proposals WHERE id = ${proposalId}
              `
            )[0]?.status ?? 'pending');
      return { mode: 'proposal', proposalId, status };
    });
  }
  return applyHermesDirect(engine, body);
}

export async function acceptHermesProposal(engine: CommercialEngine, proposalId: string) {
  return engine.db.begin(async (tx) => {
    const rows = await tx<
      {
        id: string;
        idempotency_key: string;
        operation: string;
        payload: Record<string, unknown>;
        project_id: string | null;
        status: string;
      }[]
    >`
      SELECT id, idempotency_key, operation, payload, project_id, status
      FROM hermes_write_proposals WHERE id = ${proposalId} FOR UPDATE
    `;
    const row = rows[0];
    if (!row) throw Object.assign(new Error('proposal not found'), { status: 404 });
    if (row.status === 'accepted') return { mode: 'accepted', result: null };
    if (row.status === 'rejected')
      throw Object.assign(new Error('proposal rejected'), { status: 409 });
    const body = hermesWriteBodySchema.parse({
      idempotencyKey: row.idempotency_key,
      operation: row.operation,
      payload: row.payload,
      projectId: row.project_id ?? undefined,
      confidence: 1,
      autoApply: true,
    });
    const result = await applyHermesDirectTx(engine, tx, body);
    await tx`
      UPDATE hermes_write_proposals SET status = 'accepted', resolved_at = now() WHERE id = ${proposalId}
    `;
    return result;
  });
}

export async function rejectHermesProposal(
  engine: CommercialEngine,
  proposalId: string,
  reason: string,
) {
  await engine.db`
    UPDATE hermes_write_proposals SET status = 'rejected', rejection_reason = ${reason}, resolved_at = now()
    WHERE id = ${proposalId} AND status = 'pending'
  `;
  return { status: 'rejected' };
}

async function applyHermesDirect(
  engine: CommercialEngine,
  body: ReturnType<typeof hermesWriteBodySchema.parse>,
) {
  return engine.db.begin(async (tx) => applyHermesDirectTx(engine, tx, body));
}

async function applyHermesDirectTx(
  engine: CommercialEngine,
  tx: Db,
  body: ReturnType<typeof hermesWriteBodySchema.parse>,
) {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${body.idempotencyKey}))`;
  const payloadHash = JSON.stringify(body.payload);
  const prior = await tx<
    { payload_hash: string; result_json: unknown; project_id: string | null }[]
  >`
    SELECT payload_hash, result_json, project_id FROM hermes_idempotency
    WHERE idempotency_key = ${body.idempotencyKey} FOR UPDATE
  `;
  if (prior[0]) {
    if (prior[0].payload_hash !== payloadHash) {
      throw Object.assign(new Error('idempotency key conflict'), { status: 409 });
    }
    return { mode: 'applied', result: prior[0].result_json };
  }
  const projectId = body.projectId ?? (body.payload.projectId as string | undefined);
  let result: unknown;
  switch (body.operation) {
    case 'upsert_project': {
      const name = String(body.payload.name ?? 'Hermes 项目');
      if (projectId) {
        await tx`UPDATE commercial_projects SET name = ${name}, updated_at = now() WHERE id = ${projectId}`;
        result = await engine.getProjectDetail(projectId);
      } else {
        result = await engine.createProject({ name });
      }
      break;
    }
    case 'advance_node':
      result = await engine.advanceToNode(
        String(body.payload.projectId),
        String(body.payload.nodeId),
      );
      break;
    case 'rollback_node':
      result = await engine.rollbackNode(
        String(body.payload.projectId),
        String(body.payload.nodeId),
      );
      break;
    case 'publish_video':
      result = await engine.publishProject(String(body.payload.projectId), {
        bvid: String(body.payload.bvid),
        publishedAt: String(body.payload.publishedAt),
        idempotencyKey: body.idempotencyKey,
      });
      break;
    case 'upsert_open_item': {
      const parsed = createOpenItemBodySchema.parse(body.payload);
      result = await engine.createOpenItem(String(body.payload.projectId), parsed);
      break;
    }
    case 'close_open_item':
      result = await engine.closeOpenItem(
        String(body.payload.projectId),
        String(body.payload.itemId),
        String(body.payload.conclusion ?? ''),
      );
      break;
    default:
      throw Object.assign(new Error(`unsupported operation ${body.operation}`), { status: 400 });
  }
  await tx`
    INSERT INTO hermes_idempotency (idempotency_key, operation, project_id, payload_hash, result_json)
    VALUES (${body.idempotencyKey}, ${body.operation}, ${projectId ?? null}, ${payloadHash}, ${JSON.stringify(result)}::jsonb)
  `;
  return { mode: 'applied', result };
}
