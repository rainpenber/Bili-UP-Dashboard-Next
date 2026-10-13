import type { Sql } from '@studio/db';
import type { Db } from './graph-io';
import {
  pushTemplateUndoSnapshot,
  redoTemplateGraph,
  undoTemplateGraph,
} from './template-undo-stack';

async function mutateTemplateDraft(
  tx: Db,
  versionId: string,
  fn: (tx: Db) => Promise<void>,
  opts?: { recordUndo?: boolean },
) {
  await assertDraftTx(tx, versionId);
  if (opts?.recordUndo) await pushTemplateUndoSnapshot(tx, versionId);
  await fn(tx);
}

export class TemplateEngine {
  constructor(private readonly db: Sql) {}

  async listVersions() {
    const rows = await this.db<
      {
        id: string;
        slug: string;
        name: string;
        version: number;
        is_default: boolean;
        is_draft: boolean;
        published_at: Date;
      }[]
    >`SELECT id, slug, name, version, is_default, is_draft, published_at FROM wf_template_versions ORDER BY version DESC`;
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      version: r.version,
      isDefault: r.is_default,
      isDraft: r.is_draft,
      publishedAt: r.published_at.toISOString(),
    }));
  }

  async getTemplateGraph(versionId: string) {
    const nodes = await this.db`
      SELECT id, name, slug, phase, is_optional, pos_x, pos_y, package_id FROM wf_template_nodes
      WHERE template_version_id = ${versionId}
    `;
    const edges = await this.db`
      SELECT id, from_node_id AS "fromNodeId", to_node_id AS "toNodeId" FROM wf_template_edges
      WHERE template_version_id = ${versionId}
    `;
    return { versionId, nodes, edges };
  }

  async createDraftFromDefault() {
    return this.db.begin(async (tx) => {
      const base = await tx<{ id: string; slug: string; name: string; version: number }[]>`
        SELECT id, slug, name, version FROM wf_template_versions WHERE is_default = TRUE ORDER BY version DESC LIMIT 1
      `;
      const src = base[0];
      if (!src) throw Object.assign(new Error('no default template'), { status: 500 });
      const existingDraft = await tx<{ id: string }[]>`
        SELECT id FROM wf_template_versions WHERE slug = ${src.slug} AND is_draft = TRUE LIMIT 1
      `;
      if (existingDraft[0]) {
        throw Object.assign(new Error('draft already exists for template slug'), { status: 409 });
      }
      const nextVersion = src.version + 1;
      const draftId = crypto.randomUUID();
      await tx`
        INSERT INTO wf_template_versions (id, slug, name, version, is_default, is_draft)
        VALUES (${draftId}, ${src.slug}, ${src.name}, ${nextVersion}, FALSE, TRUE)
      `;
      const pkgMap = new Map<string, string>();
      const pkgs = await tx<{ id: string; name: string; sort_order: number }[]>`
        SELECT id, name, sort_order FROM wf_template_packages WHERE template_version_id = ${src.id}
      `;
      for (const p of pkgs) {
        const nid = crypto.randomUUID();
        pkgMap.set(p.id, nid);
        await tx`
          INSERT INTO wf_template_packages (id, template_version_id, name, sort_order)
          VALUES (${nid}, ${draftId}, ${p.name}, ${p.sort_order})
        `;
      }
      const nodes = await tx<
        {
          id: string;
          slug: string;
          name: string;
          phase: string;
          is_optional: boolean;
          pos_x: number;
          pos_y: number;
          package_id: string | null;
        }[]
      >`SELECT id, slug, name, phase, is_optional, pos_x, pos_y, package_id FROM wf_template_nodes WHERE template_version_id = ${src.id}`;
      const nodeMap = new Map<string, string>();
      for (const n of nodes) {
        const newId = crypto.randomUUID();
        nodeMap.set(n.id, newId);
        await tx`
          INSERT INTO wf_template_nodes (id, template_version_id, package_id, slug, name, is_optional, pos_x, pos_y, phase)
          VALUES (${newId}, ${draftId}, ${n.package_id ? (pkgMap.get(n.package_id) ?? null) : null}, ${n.slug}, ${n.name}, ${n.is_optional}, ${n.pos_x}, ${n.pos_y}, ${n.phase})
        `;
      }
      const edges = await tx<{ from_node_id: string; to_node_id: string }[]>`
        SELECT from_node_id, to_node_id FROM wf_template_edges WHERE template_version_id = ${src.id}
      `;
      for (const e of edges) {
        const fromId = nodeMap.get(e.from_node_id);
        const toId = nodeMap.get(e.to_node_id);
        if (!fromId || !toId) continue;
        await tx`
          INSERT INTO wf_template_edges (id, template_version_id, from_node_id, to_node_id)
          VALUES (${crypto.randomUUID()}, ${draftId}, ${fromId}, ${toId})
        `;
      }
      return { draftId, nextVersion };
    });
  }

  async publishDraft(draftVersionId: string) {
    return this.db.begin(async (tx) => {
      const draft = await tx<{ id: string; is_draft: boolean }[]>`
        SELECT id, is_draft FROM wf_template_versions WHERE id = ${draftVersionId} FOR UPDATE
      `;
      if (!draft[0]?.is_draft)
        throw Object.assign(new Error('not a draft version'), { status: 409 });
      await validateTemplateGraphTx(tx, draftVersionId);
      await tx`UPDATE wf_template_versions SET is_default = FALSE WHERE is_default = TRUE`;
      await tx`
        UPDATE wf_template_versions SET is_default = TRUE, is_draft = FALSE, published_at = now()
        WHERE id = ${draftVersionId}
      `;
      return { publishedVersionId: draftVersionId };
    });
  }

  async upsertTemplateNode(
    versionId: string,
    body: {
      id?: string;
      name: string;
      slug: string;
      phase: string;
      posX: number;
      posY: number;
      isOptional?: boolean;
      packageId?: string | null;
    },
    opts?: { recordUndo?: boolean },
  ) {
    return this.db.begin(async (tx) => {
      const nodeId = body.id ?? crypto.randomUUID();
      await mutateTemplateDraft(
        tx,
        versionId,
        async (tx) => {
          if (body.id) {
            const row = await tx<{ template_version_id: string }[]>`
              SELECT template_version_id FROM wf_template_nodes WHERE id = ${body.id}
            `;
            if (row[0] && row[0].template_version_id !== versionId) {
              throw Object.assign(new Error('node belongs to another template version'), {
                status: 409,
              });
            }
          }
          await tx`
            INSERT INTO wf_template_nodes (id, template_version_id, package_id, slug, name, is_optional, pos_x, pos_y, phase)
            VALUES (${nodeId}, ${versionId}, ${body.packageId ?? null}, ${body.slug}, ${body.name}, ${body.isOptional ?? false}, ${body.posX}, ${body.posY}, ${body.phase})
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              slug = EXCLUDED.slug,
              package_id = EXCLUDED.package_id,
              is_optional = EXCLUDED.is_optional,
              pos_x = EXCLUDED.pos_x,
              pos_y = EXCLUDED.pos_y,
              phase = EXCLUDED.phase
            WHERE wf_template_nodes.template_version_id = ${versionId}
          `;
        },
        { recordUndo: opts?.recordUndo ?? true },
      );
      return nodeId;
    });
  }

  async deleteTemplateNode(versionId: string, nodeId: string) {
    return this.db.begin(async (tx) => {
      await mutateTemplateDraft(
        tx,
        versionId,
        async (tx) => {
          const deleted = await tx<{ id: string }[]>`
        DELETE FROM wf_template_nodes WHERE id = ${nodeId} AND template_version_id = ${versionId}
        RETURNING id
      `;
          if (!deleted.length) {
            throw Object.assign(new Error('template node not found'), { status: 404 });
          }
        },
        { recordUndo: true },
      );
    });
  }

  async deleteTemplateEdge(versionId: string, edgeId: string) {
    return this.db.begin(async (tx) => {
      await mutateTemplateDraft(
        tx,
        versionId,
        async (tx) => {
          const deleted = await tx<{ id: string }[]>`
        DELETE FROM wf_template_edges WHERE id = ${edgeId} AND template_version_id = ${versionId}
        RETURNING id
      `;
          if (!deleted.length) {
            throw Object.assign(new Error('template edge not found'), { status: 404 });
          }
        },
        { recordUndo: true },
      );
    });
  }

  async addTemplateEdge(versionId: string, fromNodeId: string, toNodeId: string) {
    return this.db.begin(async (tx) => {
      await mutateTemplateDraft(
        tx,
        versionId,
        async (tx) => {
          await assertTemplateEdgeAllowed(tx, versionId, fromNodeId, toNodeId);
          await tx`
        INSERT INTO wf_template_edges (id, template_version_id, from_node_id, to_node_id)
        VALUES (${crypto.randomUUID()}, ${versionId}, ${fromNodeId}, ${toNodeId})
      `;
        },
        { recordUndo: true },
      );
    });
  }

  async applyBatchTemplateLayout(
    versionId: string,
    updates: Array<{ nodeId: string; posX: number; posY: number }>,
  ) {
    return this.db.begin(async (tx) => {
      await mutateTemplateDraft(
        tx,
        versionId,
        async (tx) => {
          for (const u of updates) {
            const rows = await tx<{ id: string }[]>`
              UPDATE wf_template_nodes SET pos_x = ${u.posX}, pos_y = ${u.posY}
              WHERE id = ${u.nodeId} AND template_version_id = ${versionId}
              RETURNING id
            `;
            if (!rows.length) {
              throw Object.assign(new Error('template node not found'), { status: 404 });
            }
          }
        },
        { recordUndo: true },
      );
    });
  }

  async undoTemplate(versionId: string) {
    return this.db.begin(async (tx) => {
      await assertDraftTx(tx, versionId);
      await undoTemplateGraph(tx, versionId);
    });
  }

  async redoTemplate(versionId: string) {
    return this.db.begin(async (tx) => {
      await assertDraftTx(tx, versionId);
      await redoTemplateGraph(tx, versionId);
    });
  }

  async validateDraft(versionId: string) {
    return this.db.begin(async (tx) => validateTemplateGraphTx(tx, versionId));
  }
}

async function assertDraftTx(tx: Db, versionId: string) {
  const rows = await tx<{ is_draft: boolean }[]>`
    SELECT is_draft FROM wf_template_versions WHERE id = ${versionId} FOR UPDATE
  `;
  if (!rows[0]?.is_draft)
    throw Object.assign(new Error('only draft templates are editable'), { status: 409 });
}

async function validateTemplateGraphTx(tx: Db, versionId: string) {
  const nodes = await tx<{ id: string; slug: string }[]>`
    SELECT id, slug FROM wf_template_nodes WHERE template_version_id = ${versionId}
  `;
  if (!nodes.length) throw Object.assign(new Error('template has no nodes'), { status: 409 });
  const slugs = new Set<string>();
  for (const n of nodes) {
    if (slugs.has(n.slug))
      throw Object.assign(new Error('duplicate template node slug'), { status: 409 });
    slugs.add(n.slug);
  }
  const edges = await tx<{ from_node_id: string; to_node_id: string }[]>`
    SELECT from_node_id, to_node_id FROM wf_template_edges WHERE template_version_id = ${versionId}
  `;
  const { detectCycle } = await import('@studio/workflow');
  const cycle = detectCycle(
    nodes.map((n) => ({ id: n.id, status: 'not_reached' as const })),
    edges.map((e) => ({ fromId: e.from_node_id, toId: e.to_node_id })),
  );
  if (cycle) throw Object.assign(new Error(cycle), { status: 409 });
  const reachable = new Set<string>();
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.from_node_id) ?? [];
    list.push(e.to_node_id);
    out.set(e.from_node_id, list);
  }
  const roots = nodes.filter((n) => !edges.some((e) => e.to_node_id === n.id));
  if (!roots.length) throw Object.assign(new Error('template graph has no root'), { status: 409 });
  const stack = roots.map((r) => r.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of out.get(id) ?? []) stack.push(next);
  }
  if (reachable.size !== nodes.length) {
    throw Object.assign(new Error('template graph has unreachable nodes'), { status: 409 });
  }
}

async function assertTemplateEdgeAllowed(tx: Db, versionId: string, fromId: string, toId: string) {
  const nodes = await tx<{ id: string }[]>`
    SELECT id FROM wf_template_nodes WHERE template_version_id = ${versionId}
  `;
  const ids = new Set(nodes.map((n) => n.id));
  if (!ids.has(fromId) || !ids.has(toId))
    throw Object.assign(new Error('unknown template node'), { status: 409 });
  const edges = await tx<{ from_node_id: string; to_node_id: string }[]>`
    SELECT from_node_id, to_node_id FROM wf_template_edges WHERE template_version_id = ${versionId}
  `;
  const next = edges.map((e) => ({ fromId: e.from_node_id, toId: e.to_node_id }));
  next.push({ fromId, toId });
  const { detectCycle } = await import('@studio/workflow');
  const err = detectCycle(
    nodes.map((n) => ({ id: n.id, status: 'not_reached' })),
    next.map((e) => ({ fromId: e.fromId, toId: e.toId })),
  );
  if (err) throw Object.assign(new Error(err), { status: 409 });
}
