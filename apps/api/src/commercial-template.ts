import {
  isUuidString,
  isWfNodeKind,
  parseAddTemplateEdgeRequest,
  parseAddTemplateNodeRequest,
  parseCreateProjectFromTemplateRequest,
  parseCreatedCommercialProject,
  parseDefaultTemplateWorkspace,
  parseDisconnectTemplateEdgeRequest,
  parseRenameTemplateNodeRequest,
  parseTemplateVersionGraph,
  parseTemplateWriteError,
  type AddTemplateNodeRequest,
  type CreatedCommercialProject,
  type DefaultTemplateWorkspace,
  type TemplateVersionGraph,
  type TemplateWriteErrorBody,
  type TemplateWriteErrorCode,
  type WfNodeKind,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import {
  duplicateTemplateNodeNameMessage,
  templateCycleMessage,
  templateDuplicateEdgeMessage,
  templateMissingEdgeMessage,
  templateSelfLoopMessage,
} from '@studio/workflow';
import type { Context, Hono } from 'hono';
import postgres from 'postgres';

export const DEFAULT_TEMPLATE_SLUG = 'default_sponsorship';

/** Serialises draft/publish for the default flow. Held until the transaction ends. */
const TEMPLATE_LOCK_KEY = 915_004;

type Tx = postgres.TransactionSql;

class TemplateWriteRefusal extends Error {
  readonly status: 400 | 404 | 409;
  readonly body: TemplateWriteErrorBody;

  constructor(status: 400 | 404 | 409, code: TemplateWriteErrorCode, error: string) {
    super(error);
    this.status = status;
    this.body = { error, code };
  }
}

function refuse(status: 400 | 404 | 409, code: TemplateWriteErrorCode, error: string): never {
  throw new TemplateWriteRefusal(status, code, error);
}

type VersionRow = {
  id: string;
  slug: string;
  name: string;
  version: number | string;
  is_draft: boolean;
  is_default: boolean;
  published_at: Date | string | null;
};

type NodeRow = {
  id: string;
  package_id: string | null;
  slug: string;
  name: string;
  kind: string;
  phase: string;
  is_optional: boolean;
  pos_x: number | string;
  pos_y: number | string;
};

type EdgeRow = {
  id: string;
  from_node_id: string;
  to_node_id: string;
};

type PackageRow = {
  id: string;
  name: string;
  sort_order: number | string;
};

function asNumber(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error('invalid number from database');
  return parsed;
}

function asKind(value: string): WfNodeKind {
  if (!isWfNodeKind(value)) throw new Error(`unexpected node kind ${value}`);
  return value;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid timestamp');
  return date.toISOString();
}

async function lockTemplate(tx: Tx): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(${TEMPLATE_LOCK_KEY})`;
}

async function loadVersionGraph(
  db: Tx | Sql,
  versionId: string,
): Promise<TemplateVersionGraph | null> {
  const versions = await db<VersionRow[]>`
    SELECT id, slug, name, version, is_draft, is_default, published_at
    FROM wf_template_versions
    WHERE id = ${versionId}
  `;
  const version = versions[0];
  if (!version) return null;
  const nodes = await db<NodeRow[]>`
    SELECT id, package_id, slug, name, kind, phase, is_optional, pos_x, pos_y
    FROM wf_template_nodes
    WHERE template_version_id = ${versionId}
    ORDER BY pos_y, pos_x, id
  `;
  const edges = await db<EdgeRow[]>`
    SELECT e.id, e.from_node_id, e.to_node_id
    FROM wf_template_edges e
    JOIN wf_template_nodes fn
      ON fn.id = e.from_node_id AND fn.template_version_id = e.template_version_id
    JOIN wf_template_nodes tn
      ON tn.id = e.to_node_id AND tn.template_version_id = e.template_version_id
    WHERE e.template_version_id = ${versionId}
    ORDER BY fn.pos_y, fn.pos_x, fn.id, tn.pos_y, tn.pos_x, tn.id, e.id
  `;
  return {
    id: version.id,
    slug: version.slug,
    name: version.name,
    version: asNumber(version.version),
    isDraft: version.is_draft,
    isDefault: version.is_default,
    publishedAt:
      version.is_draft || version.published_at === null ? null : toIso(version.published_at),
    nodes: nodes.map((node) => ({
      id: node.id,
      slug: node.slug,
      name: node.name,
      kind: asKind(node.kind),
      isOptional: node.is_optional,
      posX: asNumber(node.pos_x),
      posY: asNumber(node.pos_y),
      packageId: node.package_id,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.from_node_id,
      toNodeId: edge.to_node_id,
    })),
  };
}

async function loadWorkspace(db: Tx | Sql): Promise<DefaultTemplateWorkspace> {
  const versions = await db<{ id: string }[]>`
    SELECT id
    FROM wf_template_versions
    WHERE slug = ${DEFAULT_TEMPLATE_SLUG}
    ORDER BY version DESC, id ASC
  `;
  const graphs: TemplateVersionGraph[] = [];
  for (const version of versions) {
    const graph = await loadVersionGraph(db, version.id);
    if (graph) graphs.push(graph);
  }
  return {
    slug: DEFAULT_TEMPLATE_SLUG,
    draft: graphs.find((graph) => graph.isDraft) ?? null,
    published: graphs.filter((graph) => !graph.isDraft),
  };
}

async function requireWorkspaceVersion(tx: Tx, versionId: string): Promise<VersionRow> {
  const rows = await tx<VersionRow[]>`
    SELECT id, slug, name, version, is_draft, is_default, published_at
    FROM wf_template_versions
    WHERE id = ${versionId} AND slug = ${DEFAULT_TEMPLATE_SLUG}
    FOR UPDATE
  `;
  const version = rows[0];
  if (!version) refuse(404, 'not_found', '找不到这个模板版本');
  return version;
}

function assertDraft(version: VersionRow): void {
  if (!version.is_draft) refuse(409, 'immutable', '已发布的模板版本不可修改');
}

async function assertUniqueName(tx: Tx, versionId: string, name: string, exceptId: string | null) {
  const rows = await tx<{ id: string }[]>`
    SELECT id
    FROM wf_template_nodes
    WHERE template_version_id = ${versionId}
      AND btrim(name) = ${name}
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
  `;
  if (rows[0]) refuse(409, 'duplicate_name', duplicateTemplateNodeNameMessage(name));
}

async function nodeNames(tx: Tx, versionId: string): Promise<Map<string, string>> {
  const rows = await tx<{ id: string; name: string }[]>`
    SELECT id, name FROM wf_template_nodes WHERE template_version_id = ${versionId}
  `;
  return new Map(rows.map((row) => [row.id, row.name]));
}

function postgresError(err: unknown): postgres.PostgresError | null {
  return err instanceof postgres.PostgresError ? err : null;
}

async function startDraft(tx: Tx): Promise<void> {
  await lockTemplate(tx);
  const existing = await tx<{ id: string }[]>`
    SELECT id FROM wf_template_versions
    WHERE slug = ${DEFAULT_TEMPLATE_SLUG} AND is_draft = TRUE
  `;
  if (existing[0]) return;

  const sources = await tx<VersionRow[]>`
    SELECT id, slug, name, version, is_draft, is_default, published_at
    FROM wf_template_versions
    WHERE slug = ${DEFAULT_TEMPLATE_SLUG} AND is_default = TRUE AND is_draft = FALSE
    FOR UPDATE
  `;
  const source = sources[0];
  if (!source) refuse(404, 'not_found', '没有已发布的默认流程');

  const nextRows = await tx<{ next: number | string }[]>`
    SELECT COALESCE(MAX(version), 0) + 1 AS next
    FROM wf_template_versions
    WHERE slug = ${DEFAULT_TEMPLATE_SLUG}
  `;
  const next = asNumber(nextRows[0]?.next ?? 1);
  const draftId = crypto.randomUUID();
  await tx`
    INSERT INTO wf_template_versions (id, slug, name, version, is_draft, is_default, published_at)
    VALUES (${draftId}, ${DEFAULT_TEMPLATE_SLUG}, ${source.name}, ${next}, TRUE, FALSE, NULL)
  `;

  const packages = await tx<PackageRow[]>`
    SELECT id, name, sort_order
    FROM wf_template_packages
    WHERE template_version_id = ${source.id}
    ORDER BY sort_order, id
  `;
  const packageMap = new Map<string, string>();
  for (const pkg of packages) {
    const id = crypto.randomUUID();
    packageMap.set(pkg.id, id);
    await tx`
      INSERT INTO wf_template_packages (id, template_version_id, name, sort_order)
      VALUES (${id}, ${draftId}, ${pkg.name}, ${asNumber(pkg.sort_order)})
    `;
  }

  const nodes = await tx<NodeRow[]>`
    SELECT id, package_id, slug, name, kind, phase, is_optional, pos_x, pos_y
    FROM wf_template_nodes
    WHERE template_version_id = ${source.id}
    ORDER BY pos_y, pos_x, id
  `;
  const nodeMap = new Map<string, string>();
  for (const node of nodes) {
    const id = crypto.randomUUID();
    nodeMap.set(node.id, id);
    const packageId = node.package_id === null ? null : (packageMap.get(node.package_id) ?? null);
    if (node.package_id !== null && packageId === null) {
      throw new Error('template package missing while cloning draft');
    }
    await tx`
      INSERT INTO wf_template_nodes (
        id, template_version_id, package_id, slug, name, kind, phase, is_optional, pos_x, pos_y
      ) VALUES (
        ${id}, ${draftId}, ${packageId}, ${node.slug}, ${node.name}, ${node.kind}, ${node.phase},
        ${node.is_optional}, ${asNumber(node.pos_x)}, ${asNumber(node.pos_y)}
      )
    `;
  }

  const edges = await tx<{ from_node_id: string; to_node_id: string }[]>`
    SELECT from_node_id, to_node_id
    FROM wf_template_edges
    WHERE template_version_id = ${source.id}
  `;
  for (const edge of edges) {
    const fromId = nodeMap.get(edge.from_node_id);
    const toId = nodeMap.get(edge.to_node_id);
    if (!fromId || !toId) throw new Error('template edge endpoint missing while cloning draft');
    await tx`
      INSERT INTO wf_template_edges (id, template_version_id, from_node_id, to_node_id)
      VALUES (${crypto.randomUUID()}, ${draftId}, ${fromId}, ${toId})
    `;
  }
}

async function discardDraft(tx: Tx): Promise<void> {
  await lockTemplate(tx);
  const drafts = await tx<{ id: string }[]>`
    SELECT id FROM wf_template_versions
    WHERE slug = ${DEFAULT_TEMPLATE_SLUG} AND is_draft = TRUE
    FOR UPDATE
  `;
  const draft = drafts[0];
  if (!draft) refuse(404, 'not_found', '没有可丢弃的草稿');
  await tx`DELETE FROM wf_template_versions WHERE id = ${draft.id}`;
}

async function publishDraft(tx: Tx): Promise<void> {
  await lockTemplate(tx);
  const drafts = await tx<VersionRow[]>`
    SELECT id, slug, name, version, is_draft, is_default, published_at
    FROM wf_template_versions
    WHERE slug = ${DEFAULT_TEMPLATE_SLUG} AND is_draft = TRUE
    FOR UPDATE
  `;
  const draft = drafts[0];
  if (!draft) refuse(404, 'not_found', '没有可发布的草稿');
  await tx`
    UPDATE wf_template_versions
    SET is_default = FALSE
    WHERE slug = ${DEFAULT_TEMPLATE_SLUG} AND is_default = TRUE AND id <> ${draft.id}
  `;
  await tx`
    UPDATE wf_template_versions
    SET is_draft = FALSE, is_default = TRUE, published_at = now()
    WHERE id = ${draft.id} AND is_draft = TRUE
  `;
}

async function addNode(tx: Tx, versionId: string, body: AddTemplateNodeRequest): Promise<void> {
  await lockTemplate(tx);
  const version = await requireWorkspaceVersion(tx, versionId);
  assertDraft(version);
  await assertUniqueName(tx, versionId, body.name, null);
  const slug = `n_${crypto.randomUUID().replace(/-/g, '')}`;
  try {
    await tx`
      INSERT INTO wf_template_nodes (
        id, template_version_id, package_id, slug, name, kind, phase, is_optional, pos_x, pos_y
      ) VALUES (
        ${crypto.randomUUID()}, ${versionId}, NULL, ${slug}, ${body.name}, ${body.kind},
        'pre_publish', ${body.isOptional}, ${body.posX}, ${body.posY}
      )
    `;
  } catch (err) {
    const pg = postgresError(err);
    if (pg?.code === '23505' && pg.constraint_name === 'uq_wf_template_nodes_name_per_version') {
      refuse(409, 'duplicate_name', duplicateTemplateNodeNameMessage(body.name));
    }
    throw err;
  }
}

async function renameNode(tx: Tx, versionId: string, nodeId: string, name: string): Promise<void> {
  await lockTemplate(tx);
  const version = await requireWorkspaceVersion(tx, versionId);
  assertDraft(version);
  const nodes = await tx<{ id: string }[]>`
    SELECT id FROM wf_template_nodes
    WHERE id = ${nodeId} AND template_version_id = ${versionId}
    FOR UPDATE
  `;
  if (!nodes[0]) refuse(404, 'not_found', '找不到该节点。');
  await assertUniqueName(tx, versionId, name, nodeId);
  try {
    await tx`
      UPDATE wf_template_nodes
      SET name = ${name}
      WHERE id = ${nodeId} AND template_version_id = ${versionId}
    `;
  } catch (err) {
    const pg = postgresError(err);
    if (pg?.code === '23505' && pg.constraint_name === 'uq_wf_template_nodes_name_per_version') {
      refuse(409, 'duplicate_name', duplicateTemplateNodeNameMessage(name));
    }
    throw err;
  }
}

async function deleteNode(tx: Tx, versionId: string, nodeId: string): Promise<void> {
  await lockTemplate(tx);
  const version = await requireWorkspaceVersion(tx, versionId);
  assertDraft(version);
  const deleted = await tx<{ id: string }[]>`
    DELETE FROM wf_template_nodes
    WHERE id = ${nodeId} AND template_version_id = ${versionId}
    RETURNING id
  `;
  if (!deleted[0]) refuse(404, 'not_found', '找不到该节点。');
}

async function addEdge(
  tx: Tx,
  versionId: string,
  fromNodeId: string,
  toNodeId: string,
): Promise<void> {
  await lockTemplate(tx);
  const version = await requireWorkspaceVersion(tx, versionId);
  assertDraft(version);
  if (fromNodeId === toNodeId) refuse(409, 'self_loop', templateSelfLoopMessage());
  const names = await nodeNames(tx, versionId);
  const fromName = names.get(fromNodeId);
  const toName = names.get(toNodeId);
  if (!fromName || !toName) refuse(404, 'not_found', '找不到要连接的节点。');
  const existing = await tx<{ id: string }[]>`
    SELECT id FROM wf_template_edges
    WHERE template_version_id = ${versionId}
      AND from_node_id = ${fromNodeId}
      AND to_node_id = ${toNodeId}
  `;
  if (existing[0]) refuse(409, 'duplicate_edge', templateDuplicateEdgeMessage(fromName, toName));
  try {
    await tx`
      INSERT INTO wf_template_edges (id, template_version_id, from_node_id, to_node_id)
      VALUES (${crypto.randomUUID()}, ${versionId}, ${fromNodeId}, ${toNodeId})
    `;
  } catch (err) {
    const pg = postgresError(err);
    if (pg && pg.code === 'P0001' && /cycle/i.test(pg.message)) {
      refuse(409, 'cycle', templateCycleMessage(fromName, toName));
    }
    throw err;
  }
}

async function disconnectEdge(
  tx: Tx,
  versionId: string,
  fromNodeId: string,
  toNodeId: string,
): Promise<void> {
  await lockTemplate(tx);
  const version = await requireWorkspaceVersion(tx, versionId);
  assertDraft(version);
  const names = await nodeNames(tx, versionId);
  const fromName = names.get(fromNodeId);
  const toName = names.get(toNodeId);
  if (!fromName || !toName) refuse(404, 'not_found', '找不到要断开的节点。');
  const deleted = await tx<{ id: string }[]>`
    DELETE FROM wf_template_edges
    WHERE template_version_id = ${versionId}
      AND from_node_id = ${fromNodeId}
      AND to_node_id = ${toNodeId}
    RETURNING id
  `;
  if (!deleted[0]) refuse(409, 'missing_edge', templateMissingEdgeMessage(fromName, toName));
}

async function createProjectFromTemplate(
  tx: Tx,
  name: string,
  templateVersionId: string,
): Promise<CreatedCommercialProject> {
  const versions = await tx<VersionRow[]>`
    SELECT id, slug, name, version, is_draft, is_default, published_at
    FROM wf_template_versions
    WHERE id = ${templateVersionId}
  `;
  const version = versions[0];
  if (!version) refuse(404, 'not_found', '找不到这个模板版本');
  if (version.is_draft) refuse(409, 'immutable', '只能从已发布的模板版本创建项目');

  const projectId = crypto.randomUUID();
  const workflowId = crypto.randomUUID();
  await tx`
    INSERT INTO commercial_projects (id, name)
    VALUES (${projectId}, ${name})
  `;
  await tx`
    INSERT INTO project_workflows (id, project_id, template_version_id)
    VALUES (${workflowId}, ${projectId}, ${templateVersionId})
  `;

  const packages = await tx<PackageRow[]>`
    SELECT id, name, sort_order
    FROM wf_template_packages
    WHERE template_version_id = ${templateVersionId}
    ORDER BY sort_order, id
  `;
  const packageMap = new Map<string, string>();
  for (const pkg of packages) {
    const id = crypto.randomUUID();
    packageMap.set(pkg.id, id);
    await tx`
      INSERT INTO wf_packages (id, workflow_id, name, sort_order)
      VALUES (${id}, ${workflowId}, ${pkg.name}, ${asNumber(pkg.sort_order)})
    `;
  }

  const nodes = await tx<NodeRow[]>`
    SELECT id, package_id, slug, name, kind, phase, is_optional, pos_x, pos_y
    FROM wf_template_nodes
    WHERE template_version_id = ${templateVersionId}
  `;
  const nodeMap = new Map<string, string>();
  for (const node of nodes) {
    const id = crypto.randomUUID();
    nodeMap.set(node.id, id);
    const packageId = node.package_id === null ? null : (packageMap.get(node.package_id) ?? null);
    if (node.package_id !== null && packageId === null) {
      throw new Error('template package missing while creating project');
    }
    await tx`
      INSERT INTO wf_nodes (
        id, workflow_id, project_id, template_version_id, template_node_id, package_id,
        name, kind, phase, status, is_optional, pos_x, pos_y, source
      ) VALUES (
        ${id}, ${workflowId}, ${projectId}, ${templateVersionId}, ${node.id}, ${packageId},
        ${node.name}, ${node.kind}, ${node.phase}, 'not_reached', ${node.is_optional},
        ${asNumber(node.pos_x)}, ${asNumber(node.pos_y)}, 'template'
      )
    `;
  }

  const edges = await tx<{ from_node_id: string; to_node_id: string }[]>`
    SELECT from_node_id, to_node_id
    FROM wf_template_edges
    WHERE template_version_id = ${templateVersionId}
  `;
  for (const edge of edges) {
    const fromId = nodeMap.get(edge.from_node_id);
    const toId = nodeMap.get(edge.to_node_id);
    if (!fromId || !toId) throw new Error('template edge endpoint missing while creating project');
    await tx`
      INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
      VALUES (${crypto.randomUUID()}, ${workflowId}, ${fromId}, ${toId})
    `;
  }

  return { id: projectId, name, workflowId, templateVersionId };
}

function invalidBody(c: Context, message: string): Response {
  return c.json(parseTemplateWriteError({ error: message, code: 'invalid_body' }), 400);
}

function mapTemplateError(c: Context, err: unknown): Response {
  if (err instanceof TemplateWriteRefusal) {
    return c.json(parseTemplateWriteError(err.body), err.status);
  }
  const pg = postgresError(err);
  if (
    pg &&
    (pg.code === 'P0001' || pg.code === '23514' || pg.code === '23505' || pg.code === '23503')
  ) {
    if (/immutable/i.test(pg.message)) {
      return c.json(
        parseTemplateWriteError({ error: '已发布的模板版本不可修改', code: 'immutable' }),
        409,
      );
    }
    return c.json(
      parseTemplateWriteError({
        error: `数据库约束拒绝了这次写入：${pg.message}`,
        code: 'constraint_violation',
      }),
      409,
    );
  }
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
}

function runTemplate<T>(
  c: Context,
  fn: () => Promise<T>,
  respond: (value: T) => Response,
): Promise<Response> {
  return fn()
    .then(respond)
    .catch((err: unknown) => mapTemplateError(c, err));
}

async function readBody(c: Context): Promise<unknown | Response> {
  try {
    return await c.req.json();
  } catch {
    return invalidBody(c, '请求体不是 JSON');
  }
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function parseRequest<T>(c: Context, raw: unknown, parse: (value: unknown) => T): T | Response {
  try {
    return parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid body';
    return invalidBody(c, message);
  }
}

function versionIdParam(c: Context): string | Response {
  const versionId = c.req.param('versionId');
  if (!isUuidString(versionId)) return invalidBody(c, '模板版本 id 不是 uuid');
  return versionId;
}

export function registerCommercialTemplateRoutes(app: Hono, db: Sql): void {
  app.get('/templates/default/workspace', async (c) => {
    try {
      return c.json(parseDefaultTemplateWorkspace(await loadWorkspace(db)));
    } catch (err) {
      console.error(err);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  app.get('/templates/default/versions/:versionId', async (c) => {
    const versionId = versionIdParam(c);
    if (versionId instanceof Response) return versionId;
    try {
      const graph = await loadVersionGraph(db, versionId);
      if (!graph || graph.slug !== DEFAULT_TEMPLATE_SLUG) {
        return c.json(
          parseTemplateWriteError({ error: '找不到这个模板版本', code: 'not_found' }),
          404,
        );
      }
      return c.json(parseTemplateVersionGraph(graph));
    } catch (err) {
      console.error(err);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  app.post('/templates/default/draft', (c) =>
    runTemplate(
      c,
      () =>
        db.begin(async (tx) => {
          await startDraft(tx);
          return loadWorkspace(tx);
        }),
      (workspace) => c.json(parseDefaultTemplateWorkspace(workspace)),
    ),
  );

  app.delete('/templates/default/draft', (c) =>
    runTemplate(
      c,
      () =>
        db.begin(async (tx) => {
          await discardDraft(tx);
          return loadWorkspace(tx);
        }),
      (workspace) => c.json(parseDefaultTemplateWorkspace(workspace)),
    ),
  );

  app.post('/templates/default/draft/publish', (c) =>
    runTemplate(
      c,
      () =>
        db.begin(async (tx) => {
          await publishDraft(tx);
          return loadWorkspace(tx);
        }),
      (workspace) => c.json(parseDefaultTemplateWorkspace(workspace)),
    ),
  );

  app.post('/templates/default/versions/:versionId/nodes', async (c) => {
    const versionId = versionIdParam(c);
    if (versionId instanceof Response) return versionId;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseAddTemplateNodeRequest);
    if (body instanceof Response) return body;
    return runTemplate(
      c,
      () =>
        db.begin(async (tx) => {
          await addNode(tx, versionId, body);
          return loadWorkspace(tx);
        }),
      (workspace) => c.json(parseDefaultTemplateWorkspace(workspace)),
    );
  });

  app.patch('/templates/default/versions/:versionId/nodes/:nodeId', async (c) => {
    const versionId = versionIdParam(c);
    if (versionId instanceof Response) return versionId;
    const nodeId = c.req.param('nodeId');
    if (!isUuidString(nodeId)) return invalidBody(c, '节点 id 不是 uuid');
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseRenameTemplateNodeRequest);
    if (body instanceof Response) return body;
    return runTemplate(
      c,
      () =>
        db.begin(async (tx) => {
          await renameNode(tx, versionId, nodeId, body.name);
          return loadWorkspace(tx);
        }),
      (workspace) => c.json(parseDefaultTemplateWorkspace(workspace)),
    );
  });

  app.delete('/templates/default/versions/:versionId/nodes/:nodeId', async (c) => {
    const versionId = versionIdParam(c);
    if (versionId instanceof Response) return versionId;
    const nodeId = c.req.param('nodeId');
    if (!isUuidString(nodeId)) return invalidBody(c, '节点 id 不是 uuid');
    return runTemplate(
      c,
      () =>
        db.begin(async (tx) => {
          await deleteNode(tx, versionId, nodeId);
          return loadWorkspace(tx);
        }),
      (workspace) => c.json(parseDefaultTemplateWorkspace(workspace)),
    );
  });

  app.post('/templates/default/versions/:versionId/edges', async (c) => {
    const versionId = versionIdParam(c);
    if (versionId instanceof Response) return versionId;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseAddTemplateEdgeRequest);
    if (body instanceof Response) return body;
    return runTemplate(
      c,
      () =>
        db.begin(async (tx) => {
          await addEdge(tx, versionId, body.fromNodeId, body.toNodeId);
          return loadWorkspace(tx);
        }),
      (workspace) => c.json(parseDefaultTemplateWorkspace(workspace)),
    );
  });

  app.post('/templates/default/versions/:versionId/edges/disconnect', async (c) => {
    const versionId = versionIdParam(c);
    if (versionId instanceof Response) return versionId;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseDisconnectTemplateEdgeRequest);
    if (body instanceof Response) return body;
    return runTemplate(
      c,
      () =>
        db.begin(async (tx) => {
          await disconnectEdge(tx, versionId, body.fromNodeId, body.toNodeId);
          return loadWorkspace(tx);
        }),
      (workspace) => c.json(parseDefaultTemplateWorkspace(workspace)),
    );
  });

  app.post('/projects', async (c) => {
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCreateProjectFromTemplateRequest);
    if (body instanceof Response) return body;
    return runTemplate(
      c,
      () => db.begin((tx) => createProjectFromTemplate(tx, body.name, body.templateVersionId)),
      (created) => c.json(parseCreatedCommercialProject(created), 201),
    );
  });
}
