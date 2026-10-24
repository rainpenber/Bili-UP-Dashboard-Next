import { createHash, randomUUID } from 'node:crypto';

const DEFAULT_FLOW_SLUG = 'default_sponsorship';

export type DefaultTemplateRef = {
  id: string;
  slug: string;
  version: number;
};

export type InstantiatedWorkflow = {
  workflowId: string;
  templateVersionId: string;
  nodeCount: number;
  edgeCount: number;
};

/** Minimal queryable surface shared by Sql and TransactionSql. */
export type CommercialIngressSql = (
  strings: TemplateStringsArray,
  ...values: readonly unknown[]
) => Promise<readonly Record<string, unknown>[]>;

/** Stable JSON for content hashing: sorted object keys, arrays keep order. */
export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = canonicalize(record[key]);
  }
  return out;
}

export function commercialIngressContentHash(input: {
  name: string;
  netAmount: string | null;
  rebateAmount: string | null;
  sourceStatus: string | null;
  sourceNotes: string | null;
  payload: Record<string, unknown>;
  evidence: Record<string, unknown>;
}): string {
  return createHash('sha256')
    .update(
      stableJsonStringify({
        name: input.name,
        netAmount: input.netAmount,
        rebateAmount: input.rebateAmount,
        sourceStatus: input.sourceStatus,
        sourceNotes: input.sourceNotes,
        payload: input.payload,
        evidence: input.evidence,
      }),
    )
    .digest('hex');
}

/** Two int4 keys derived from namespace+sourceId for pg_advisory_xact_lock. */
export function sourceAdvisoryLockKeys(namespace: string, sourceId: string): [number, number] {
  const digest = createHash('sha256').update(namespace).update('\0').update(sourceId).digest();
  const k1 = digest.readInt32BE(0);
  const k2 = digest.readInt32BE(4);
  return [k1, k2];
}

export async function loadPublishedDefaultTemplate(
  sql: CommercialIngressSql,
): Promise<DefaultTemplateRef | null> {
  const rows = (await sql`
    SELECT id, slug, version
    FROM wf_template_versions
    WHERE slug = ${DEFAULT_FLOW_SLUG}
      AND is_default = TRUE
      AND is_draft = FALSE
    LIMIT 1
  `) as DefaultTemplateRef[];
  return rows[0] ?? null;
}

/**
 * Copy the published default template into a new workflow instance.
 * Nodes start as not_reached. Missing default template is the caller's refusal.
 * Verifies every node/edge package belongs to the same workflow+project.
 */
export async function instantiateDefaultWorkflow(
  tx: CommercialIngressSql,
  projectId: string,
  template: DefaultTemplateRef,
): Promise<InstantiatedWorkflow> {
  const workflowId = randomUUID();
  await tx`
    INSERT INTO project_workflows (id, project_id, template_version_id)
    VALUES (${workflowId}, ${projectId}, ${template.id})
  `;

  const packages = (await tx`
    SELECT id, name, sort_order
    FROM wf_template_packages
    WHERE template_version_id = ${template.id}
    ORDER BY sort_order ASC, id ASC
  `) as { id: string; name: string; sort_order: number }[];
  const packageMap = new Map<string, string>();
  for (const pkg of packages) {
    const id = randomUUID();
    packageMap.set(pkg.id, id);
    await tx`
      INSERT INTO wf_packages (id, workflow_id, name, sort_order)
      VALUES (${id}, ${workflowId}, ${pkg.name}, ${pkg.sort_order})
    `;
  }

  const nodes = (await tx`
    SELECT id, name, kind, phase, is_optional, pos_x, pos_y, package_id
    FROM wf_template_nodes
    WHERE template_version_id = ${template.id}
    ORDER BY pos_y ASC, pos_x ASC, id ASC
  `) as {
    id: string;
    name: string;
    kind: string;
    phase: string;
    is_optional: boolean;
    pos_x: number;
    pos_y: number;
    package_id: string | null;
  }[];
  const nodeMap = new Map<string, string>();
  for (const node of nodes) {
    const id = randomUUID();
    nodeMap.set(node.id, id);
    const packageId = node.package_id ? (packageMap.get(node.package_id) ?? null) : null;
    if (node.package_id && packageId === null) {
      throw new Error(`template package ${node.package_id} missing for node ${node.id}`);
    }
    await tx`
      INSERT INTO wf_nodes (
        id, workflow_id, project_id, template_version_id, template_node_id, package_id,
        name, kind, phase, status, is_optional, pos_x, pos_y, source
      ) VALUES (
        ${id}, ${workflowId}, ${projectId}, ${template.id}, ${node.id}, ${packageId},
        ${node.name}, ${node.kind}, ${node.phase}, 'not_reached', ${node.is_optional},
        ${node.pos_x}, ${node.pos_y}, 'template'
      )
    `;
  }

  const edges = (await tx`
    SELECT from_node_id, to_node_id
    FROM wf_template_edges
    WHERE template_version_id = ${template.id}
    ORDER BY from_node_id ASC, to_node_id ASC
  `) as { from_node_id: string; to_node_id: string }[];
  for (const edge of edges) {
    const fromId = nodeMap.get(edge.from_node_id);
    const toId = nodeMap.get(edge.to_node_id);
    if (!fromId || !toId) throw new Error('template edge endpoint missing');
    await tx`
      INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
      VALUES (${randomUUID()}, ${workflowId}, ${fromId}, ${toId})
    `;
  }

  const ownershipRows = (await tx`
    SELECT
      (
        SELECT count(*)::text FROM wf_nodes n
        WHERE n.workflow_id = ${workflowId}
          AND (n.project_id IS DISTINCT FROM ${projectId} OR n.workflow_id IS DISTINCT FROM ${workflowId})
      ) AS bad_nodes,
      (
        SELECT count(*)::text FROM wf_edges e
        WHERE e.workflow_id = ${workflowId}
          AND NOT EXISTS (
            SELECT 1 FROM wf_nodes fn
            WHERE fn.id = e.from_node_id AND fn.workflow_id = e.workflow_id AND fn.project_id = ${projectId}
          )
      ) AS bad_edges
  `) as { bad_nodes: string; bad_edges: string }[];
  const ownership = ownershipRows[0];
  if (Number(ownership?.bad_nodes ?? 1) !== 0 || Number(ownership?.bad_edges ?? 1) !== 0) {
    throw new Error('workflow ownership verification failed');
  }

  return {
    workflowId,
    templateVersionId: template.id,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}
