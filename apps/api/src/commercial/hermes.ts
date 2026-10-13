import type { CommercialEngine } from './engine';
import { hermesWriteBodySchema } from '@studio/contracts';

export async function executeHermesOperation(
  engine: CommercialEngine,
  raw: Record<string, unknown>,
) {
  const body = hermesWriteBodySchema.parse(raw);
  const auto = body.autoApply || body.confidence >= 0.85;
  if (!auto) {
    return engine.db.begin(async (tx) => {
      const id = crypto.randomUUID();
      await tx`
        INSERT INTO hermes_write_proposals (id, project_id, idempotency_key, operation, status, payload, source_evidence, confidence)
        VALUES (${id}, ${body.projectId ?? null}, ${body.idempotencyKey}, ${body.operation}, 'pending', ${JSON.stringify(body.payload)}::jsonb, ${body.sourceEvidence ? JSON.stringify(body.sourceEvidence) : null}::jsonb, ${body.confidence})
        ON CONFLICT (idempotency_key) DO NOTHING
      `;
      return { mode: 'proposal', proposalId: id, status: 'pending' };
    });
  }
  return applyHermesDirect(engine, body);
}

async function applyHermesDirect(
  engine: CommercialEngine,
  body: ReturnType<typeof hermesWriteBodySchema.parse>,
) {
  const prior = await engine.db<
    { result_json: unknown; payload_hash: string; project_id: string | null }[]
  >`
    SELECT result_json, payload_hash, project_id FROM hermes_idempotency WHERE idempotency_key = ${body.idempotencyKey}
  `;
  const payloadHash = JSON.stringify(body.payload);
  if (prior[0]) {
    if (prior[0].payload_hash !== payloadHash) {
      throw Object.assign(new Error('idempotency key conflict'), { status: 409 });
    }
    return prior[0].result_json;
  }
  let result: unknown;
  switch (body.operation) {
    case 'upsert_project':
      result = await engine.createProject({
        name: String(body.payload.name ?? 'Hermes 项目'),
      });
      break;
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
    case 'upsert_open_item':
      result = await engine.createOpenItem(String(body.payload.projectId), body.payload);
      break;
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
  await engine.db`
    INSERT INTO hermes_idempotency (idempotency_key, operation, project_id, payload_hash, result_json)
    VALUES (${body.idempotencyKey}, ${body.operation}, ${body.projectId ?? null}, ${payloadHash}, ${JSON.stringify(result)}::jsonb)
  `;
  return { mode: 'applied', result };
}
