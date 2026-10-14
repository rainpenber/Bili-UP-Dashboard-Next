import type { Db } from './graph-io';

export async function recordNodeStatusHistory(
  tx: Db,
  input: {
    projectId: string;
    nodeId: string;
    fromStatus: string | null;
    toStatus: string;
    source: string;
    detail?: Record<string, unknown> | null;
    note?: string | null;
  },
) {
  if (input.fromStatus === input.toStatus) return;
  const detail = input.detail ?? (input.note ? { note: input.note } : null);
  await tx`
    INSERT INTO wf_node_status_history (project_id, node_id, from_status, to_status, source, detail)
    VALUES (
      ${input.projectId},
      ${input.nodeId},
      ${input.fromStatus},
      ${input.toStatus},
      ${input.source},
      ${detail ? (JSON.stringify(detail) as never) : null}
    )
  `;
}
