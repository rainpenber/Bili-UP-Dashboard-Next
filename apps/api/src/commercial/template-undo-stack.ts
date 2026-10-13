import type { Db } from './graph-io';

const MAX_UNDO = 40;

export type TemplateUndoSnapshot = {
  nodes: Array<{
    id: string;
    name: string;
    slug: string;
    phase: string;
    is_optional: boolean;
    pos_x: number;
    pos_y: number;
    package_id: string | null;
  }>;
  edges: Array<{ id: string; from_node_id: string; to_node_id: string }>;
  packages: Array<{ id: string; name: string; sort_order: number }>;
};

async function captureTemplateSnapshot(tx: Db, versionId: string): Promise<TemplateUndoSnapshot> {
  const nodes = await tx<TemplateUndoSnapshot['nodes'][number][]>`
    SELECT id, name, slug, phase, is_optional, pos_x, pos_y, package_id
    FROM wf_template_nodes WHERE template_version_id = ${versionId}
  `;
  const edges = await tx<TemplateUndoSnapshot['edges'][number][]>`
    SELECT id, from_node_id, to_node_id FROM wf_template_edges WHERE template_version_id = ${versionId}
  `;
  const packages = await tx<TemplateUndoSnapshot['packages'][number][]>`
    SELECT id, name, sort_order FROM wf_template_packages WHERE template_version_id = ${versionId}
  `;
  return { nodes, edges, packages };
}

function parseUndoJson(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function asSnapshotArray(raw: unknown): TemplateUndoSnapshot[] {
  const parsed = parseUndoJson(raw);
  if (parsed == null) return [];
  if (Array.isArray(parsed)) return parsed as TemplateUndoSnapshot[];
  return [parsed as TemplateUndoSnapshot];
}

export async function pushTemplateUndoSnapshot(tx: Db, versionId: string) {
  const snap = await captureTemplateSnapshot(tx, versionId);
  const rows = await tx<{ undo_json: unknown }[]>`
    SELECT undo_json FROM template_undo_stacks WHERE template_version_id = ${versionId} FOR UPDATE
  `;
  const prev = asSnapshotArray(rows[0]?.undo_json);
  const next = [...prev, snap].slice(-MAX_UNDO);
  await tx`
    INSERT INTO template_undo_stacks (template_version_id, undo_json, redo_json)
    VALUES (${versionId}, ${next as never}, '[]'::jsonb)
    ON CONFLICT (template_version_id) DO UPDATE SET
      undo_json = ${next as never},
      redo_json = '[]'::jsonb,
      updated_at = now()
  `;
}

async function restoreTemplateSnapshot(tx: Db, versionId: string, snap: TemplateUndoSnapshot) {
  await tx`DELETE FROM wf_template_edges WHERE template_version_id = ${versionId}`;
  await tx`DELETE FROM wf_template_nodes WHERE template_version_id = ${versionId}`;
  await tx`DELETE FROM wf_template_packages WHERE template_version_id = ${versionId}`;
  for (const p of snap.packages) {
    await tx`
      INSERT INTO wf_template_packages (id, template_version_id, name, sort_order)
      VALUES (${p.id}, ${versionId}, ${p.name}, ${p.sort_order})
    `;
  }
  for (const n of snap.nodes) {
    await tx`
      INSERT INTO wf_template_nodes (id, template_version_id, package_id, slug, name, is_optional, pos_x, pos_y, phase)
      VALUES (${n.id}, ${versionId}, ${n.package_id}, ${n.slug}, ${n.name}, ${n.is_optional}, ${n.pos_x}, ${n.pos_y}, ${n.phase})
    `;
  }
  for (const e of snap.edges) {
    await tx`
      INSERT INTO wf_template_edges (id, template_version_id, from_node_id, to_node_id)
      VALUES (${e.id}, ${versionId}, ${e.from_node_id}, ${e.to_node_id})
    `;
  }
}

export async function undoTemplateGraph(tx: Db, versionId: string) {
  const rows = await tx<{ undo_json: unknown; redo_json: unknown }[]>`
    SELECT undo_json, redo_json FROM template_undo_stacks WHERE template_version_id = ${versionId} FOR UPDATE
  `;
  const undo = asSnapshotArray(rows[0]?.undo_json);
  if (!undo.length) throw Object.assign(new Error('nothing to undo'), { status: 409 });
  const snap = undo[undo.length - 1]!;
  const current = await captureTemplateSnapshot(tx, versionId);
  await restoreTemplateSnapshot(tx, versionId, snap);
  const redo = asSnapshotArray(rows[0]?.redo_json);
  const nextRedo = [...redo, current];
  await tx`
    INSERT INTO template_undo_stacks (template_version_id, undo_json, redo_json)
    VALUES (${versionId}, ${undo.slice(0, -1) as never}, ${nextRedo as never})
    ON CONFLICT (template_version_id) DO UPDATE SET
      undo_json = ${undo.slice(0, -1) as never},
      redo_json = ${nextRedo as never},
      updated_at = now()
  `;
}

export async function redoTemplateGraph(tx: Db, versionId: string) {
  const rows = await tx<{ undo_json: unknown; redo_json: unknown }[]>`
    SELECT undo_json, redo_json FROM template_undo_stacks WHERE template_version_id = ${versionId} FOR UPDATE
  `;
  const redo = asSnapshotArray(rows[0]?.redo_json);
  if (!redo.length) throw Object.assign(new Error('nothing to redo'), { status: 409 });
  const snap = redo[redo.length - 1]!;
  const current = await captureTemplateSnapshot(tx, versionId);
  await restoreTemplateSnapshot(tx, versionId, snap);
  const undo = asSnapshotArray(rows[0]?.undo_json);
  const nextUndo = [...undo, current];
  await tx`
    UPDATE template_undo_stacks SET
      undo_json = ${nextUndo as never},
      redo_json = ${redo.slice(0, -1) as never},
      updated_at = now()
    WHERE template_version_id = ${versionId}
  `;
}
