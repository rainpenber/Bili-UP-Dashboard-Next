import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  parseCommercialDefaultTemplate,
  parseCreatedCommercialProject,
  parseDefaultTemplateWorkspace,
  parseTemplateVersionGraph,
  parseTemplateWriteError,
  type DefaultTemplateWorkspace,
  type TemplateVersionGraph,
  type TemplateWriteErrorBody,
} from '@studio/contracts';
import {
  duplicateTemplateNodeNameMessage,
  templateCycleMessage,
  templateSelfLoopMessage,
} from '@studio/workflow';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  isPostgresRequiredEnv,
  type Sql,
} from '@studio/db';
import { createApp } from './app';
import { createCommercialRoutes } from './commercial-routes';

const DEFAULT_TEMPLATE = 'ffff1111-1111-4111-8111-111111111111';

type App = ReturnType<typeof createApp>;

describe('template draft publish and create project', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let app: App | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) {
      if (isPostgresRequiredEnv()) {
        throw new Error('PostgreSQL required in CI but isolated database setup failed');
      }
      return;
    }
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    app = createApp({ skipDb: true });
    app.route('/api/v1/commercial', createCommercialRoutes(sql));
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('edits a draft, refuses reviewed cases, publishes, and materialises a new project', async () => {
    if (!sql || !app) return;
    const api = app;
    const db = sql;

    const [nameUnique] = await db<{ c: string }[]>`
      SELECT count(*)::text AS c
      FROM pg_indexes
      WHERE tablename = 'commercial_projects'
        AND indexdef ILIKE '%UNIQUE%'
        AND indexdef ILIKE '%(name)%'
    `;
    expect(nameUnique?.c).toBe('0');

    const sentinel = parseCreatedCommercialProject(
      await expectOk(
        await api.request(
          '/api/v1/commercial/projects',
          json({ name: '已有项目', templateVersionId: DEFAULT_TEMPLATE }),
        ),
        201,
      ),
    );
    const sentinelBefore = await projectSnapshot(db, sentinel.id);
    expect(sentinelBefore.templateVersionId).toBe(DEFAULT_TEMPLATE);
    expect(sentinelBefore.nodes).toHaveLength(14);
    expect(sentinelBefore.nodes.every((node) => node.status === 'not_reached')).toBe(true);

    const started = await workspace(
      await api.request('/api/v1/commercial/templates/default/draft', { method: 'POST' }),
    );
    const draft = started.draft;
    if (!draft) throw new Error('draft was not created');
    expect(draft.version).toBe(2);
    expect(draft.isDraft).toBe(true);
    expect(draft.isDefault).toBe(false);
    expect(draft.nodes).toHaveLength(14);
    expect(draft.edges).toHaveLength(16);
    expect(draft.nodes.map((node) => node.id)).not.toContain(DEFAULT_TEMPLATE);
    expect(new Set(draft.nodes.map((node) => node.id)).size).toBe(14);

    const publishedV1 = started.published.find((version) => version.id === DEFAULT_TEMPLATE);
    if (!publishedV1) throw new Error('v1 missing');
    const v1Counts = await versionCounts(db, DEFAULT_TEMPLATE);
    const refusedEdit = await expectTemplateError(
      await api.request(
        `/api/v1/commercial/templates/default/versions/${DEFAULT_TEMPLATE}/nodes`,
        json({
          name: '偷偷改',
          kind: 'stage',
          isOptional: false,
          posX: 0,
          posY: 0,
        }),
      ),
      409,
      'immutable',
    );
    expect(refusedEdit.error).toBe('已发布的模板版本不可修改');
    expect(await versionCounts(db, DEFAULT_TEMPLATE)).toEqual(v1Counts);

    const duplicate = await expectTemplateError(
      await api.request(
        `/api/v1/commercial/templates/default/versions/${draft.id}/nodes`,
        json({
          name: ' 大纲 ',
          kind: 'stage',
          isOptional: false,
          posX: 1,
          posY: 1,
        }),
      ),
      409,
      'duplicate_name',
    );
    expect(duplicate.error).toBe(duplicateTemplateNodeNameMessage('大纲'));

    const inquiry = nodeByName(draft, '询单');
    const publish = nodeByName(draft, '发布');
    const selfLoop = await expectTemplateError(
      await api.request(
        `/api/v1/commercial/templates/default/versions/${draft.id}/edges`,
        json({
          fromNodeId: inquiry.id,
          toNodeId: inquiry.id,
        }),
      ),
      409,
      'self_loop',
    );
    expect(selfLoop.error).toBe(templateSelfLoopMessage());

    const cycle = await expectTemplateError(
      await api.request(
        `/api/v1/commercial/templates/default/versions/${draft.id}/edges`,
        json({
          fromNodeId: publish.id,
          toNodeId: inquiry.id,
        }),
      ),
      409,
      'cycle',
    );
    expect(cycle.error).toBe(templateCycleMessage('发布', '询单'));
    expect(await versionCounts(db, draft.id)).toEqual({ nodes: 14, edges: 16 });

    const outline = nodeByName(draft, '大纲');
    const outlineEdgeIds = draft.edges
      .filter((edge) => edge.fromNodeId === outline.id || edge.toNodeId === outline.id)
      .map((edge) => edge.id);
    expect(outlineEdgeIds).toHaveLength(3);
    const afterDelete = await workspace(
      await api.request(
        `/api/v1/commercial/templates/default/versions/${draft.id}/nodes/${outline.id}`,
        { method: 'DELETE' },
      ),
    );
    const draftAfterDelete = afterDelete.draft;
    if (!draftAfterDelete) throw new Error('draft disappeared');
    expect(draftAfterDelete.nodes.some((node) => node.name === '大纲')).toBe(false);
    expect(
      draftAfterDelete.edges.map((edge) => edge.id).some((id) => outlineEdgeIds.includes(id)),
    ).toBe(false);
    const remainingEdgeIds = new Set(draft.edges.map((edge) => edge.id));
    for (const id of outlineEdgeIds) remainingEdgeIds.delete(id);
    expect(new Set(draftAfterDelete.edges.map((edge) => edge.id))).toEqual(remainingEdgeIds);
    expect(draftAfterDelete.nodes).toHaveLength(13);
    expect(draftAfterDelete.edges).toHaveLength(13);

    const added = await workspace(
      await api.request(
        `/api/v1/commercial/templates/default/versions/${draft.id}/nodes`,
        json({
          name: '发布后回访',
          kind: 'merge',
          isOptional: true,
          posX: 40,
          posY: 900,
        }),
      ),
    );
    const withNode = added.draft;
    if (!withNode) throw new Error('draft disappeared');
    const visit = nodeByName(withNode, '发布后回访');
    expect(visit.kind).toBe('merge');
    expect(visit.isOptional).toBe(true);
    expect(visit.posX).toBe(40);
    expect(visit.posY).toBe(900);

    const renamed = await workspace(
      await api.request(
        `/api/v1/commercial/templates/default/versions/${draft.id}/nodes/${visit.id}`,
        json({ name: '回访' }, 'PATCH'),
      ),
    );
    expect(renamed.draft && nodeByName(renamed.draft, '回访').id).toBe(visit.id);
    const renameClash = await expectTemplateError(
      await api.request(
        `/api/v1/commercial/templates/default/versions/${draft.id}/nodes/${visit.id}`,
        json({ name: '询单' }, 'PATCH'),
      ),
      409,
      'duplicate_name',
    );
    expect(renameClash.error).toBe(duplicateTemplateNodeNameMessage('询单'));

    const publishNode = nodeByName(withNode, '发布');
    const wired = await workspace(
      await api.request(
        `/api/v1/commercial/templates/default/versions/${draft.id}/edges`,
        json({
          fromNodeId: publishNode.id,
          toNodeId: visit.id,
        }),
      ),
    );
    const wiredDraft = wired.draft;
    if (!wiredDraft) throw new Error('draft disappeared');
    expect(
      wiredDraft.edges.some(
        (edge) => edge.fromNodeId === publishNode.id && edge.toNodeId === visit.id,
      ),
    ).toBe(true);

    const published = await workspace(
      await api.request('/api/v1/commercial/templates/default/draft/publish', { method: 'POST' }),
    );
    expect(published.draft).toBeNull();
    const v2 = published.published.find((version) => version.version === 2);
    const v1 = published.published.find((version) => version.version === 1);
    if (!v2 || !v1) throw new Error('published versions missing');
    expect(v2.isDefault).toBe(true);
    expect(v2.isDraft).toBe(false);
    expect(v2.id).toBe(draft.id);
    expect(v1.id).toBe(DEFAULT_TEMPLATE);
    expect(v1.isDefault).toBe(false);
    expect(v1.version).toBe(1);
    expect(v1.nodes).toHaveLength(14);
    expect(v1.edges).toHaveLength(16);
    expect(v1.nodes.some((node) => node.name === '回访')).toBe(false);
    expect(v2.nodes.some((node) => node.name === '回访')).toBe(true);
    expect(v2.publishedAt).not.toBeNull();

    const readableV1 = parseTemplateVersionGraph(
      await expectOk(
        await api.request(`/api/v1/commercial/templates/default/versions/${DEFAULT_TEMPLATE}`),
        200,
      ),
    );
    expect(readableV1.version).toBe(1);
    expect(readableV1.nodes.some((node) => node.name === '大纲')).toBe(true);

    const defaultTemplate = parseCommercialDefaultTemplate(
      await expectOk(await api.request('/api/v1/commercial/templates/default'), 200),
    );
    expect(defaultTemplate.id).toBe(v2.id);
    expect(defaultTemplate.version).toBe(2);

    const stillRefused = await expectTemplateError(
      await api.request(
        `/api/v1/commercial/templates/default/versions/${v2.id}/nodes`,
        json({
          name: '发布后再改',
          kind: 'stage',
          isOptional: false,
          posX: 0,
          posY: 0,
        }),
      ),
      409,
      'immutable',
    );
    expect(stillRefused.error).toBe('已发布的模板版本不可修改');

    const sentinelAfter = await projectSnapshot(db, sentinel.id);
    expect(sentinelAfter).toEqual(sentinelBefore);

    const created = parseCreatedCommercialProject(
      await expectOk(
        await api.request(
          '/api/v1/commercial/projects',
          json({ name: '同名项目', templateVersionId: v2.id }),
        ),
        201,
      ),
    );
    const again = parseCreatedCommercialProject(
      await expectOk(
        await api.request(
          '/api/v1/commercial/projects',
          json({ name: '同名项目', templateVersionId: v2.id }),
        ),
        201,
      ),
    );
    expect(again.id).not.toBe(created.id);
    const [sameName] = await db<{ c: string }[]>`
      SELECT count(*)::text AS c FROM commercial_projects WHERE name = '同名项目'
    `;
    expect(sameName?.c).toBe('2');

    const materialised = await projectSnapshot(db, created.id);
    expect(materialised.templateVersionId).toBe(v2.id);
    expect(materialised.overallStage).toBe('pre_publish');
    expect(materialised.nodes.map((node) => node.name).sort()).toEqual(
      v2.nodes.map((node) => node.name).sort(),
    );
    expect(materialised.nodes.every((node) => node.status === 'not_reached')).toBe(true);
    expect(materialised.edgeCount).toBe(v2.edges.length);
    expect(materialised.packageCount).toBe(1);
    const visitRow = materialised.nodes.find((node) => node.name === '回访');
    expect(visitRow).toEqual(
      expect.objectContaining({
        kind: 'merge',
        is_optional: true,
        status: 'not_reached',
        pos_x: 40,
        pos_y: 900,
        package_id: null,
      }),
    );
    const packaged = materialised.nodes
      .filter((node) => node.package_name === '制作并行包')
      .map((node) => node.name)
      .sort();
    expect(packaged).toEqual(['A-roll 拍摄', 'AI 后期', 'B-roll 素材']);
    const merge = materialised.nodes.find((node) => node.name === '汇合节点');
    expect(merge?.kind).toBe('merge');
    expect(merge?.is_optional).toBe(true);
    const [publishRecord] = await db<{ c: string }[]>`
      SELECT count(*)::text AS c FROM project_publish_records WHERE project_id = ${created.id}
    `;
    expect(publishRecord?.c).toBe('0');
    expect(await projectSnapshot(db, sentinel.id)).toEqual(sentinelBefore);

    const nextDraft = await workspace(
      await api.request('/api/v1/commercial/templates/default/draft', { method: 'POST' }),
    );
    expect(nextDraft.draft?.version).toBe(3);
    expect(nextDraft.draft?.isDefault).toBe(false);
    const discarded = await workspace(
      await api.request('/api/v1/commercial/templates/default/draft', { method: 'DELETE' }),
    );
    expect(discarded.draft).toBeNull();
    expect(discarded.published.find((version) => version.version === 2)?.isDefault).toBe(true);
    expect(discarded.published.find((version) => version.version === 1)?.version).toBe(1);
    const [gone] = await db<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_template_versions WHERE slug = 'default_sponsorship' AND version = 3
    `;
    expect(gone?.c).toBe('0');
  }, 60_000);
});

function json(body: unknown, method = 'POST'): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function expectOk(res: Response, status: number): Promise<unknown> {
  const body: unknown = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body;
}

async function workspace(res: Response): Promise<DefaultTemplateWorkspace> {
  return parseDefaultTemplateWorkspace(await expectOk(res, 200));
}

async function expectTemplateError(
  res: Response,
  status: number,
  code: TemplateWriteErrorBody['code'],
): Promise<TemplateWriteErrorBody> {
  const body: unknown = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  const parsed = parseTemplateWriteError(body);
  expect(parsed.code).toBe(code);
  return parsed;
}

function nodeByName(version: TemplateVersionGraph, name: string) {
  const node = version.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`missing template node ${name}`);
  return node;
}

async function versionCounts(
  db: Sql,
  versionId: string,
): Promise<{ nodes: number; edges: number }> {
  const [row] = await db<{ nodes: string; edges: string }[]>`
    SELECT
      (SELECT count(*)::text FROM wf_template_nodes WHERE template_version_id = ${versionId}) AS nodes,
      (SELECT count(*)::text FROM wf_template_edges WHERE template_version_id = ${versionId}) AS edges
  `;
  return { nodes: Number(row?.nodes ?? 0), edges: Number(row?.edges ?? 0) };
}

type ProjectNode = {
  id: string;
  name: string;
  status: string;
  kind: string;
  is_optional: boolean;
  pos_x: number;
  pos_y: number;
  package_id: string | null;
  package_name: string | null;
  template_node_id: string | null;
  updated_at: string;
};

async function projectSnapshot(db: Sql, projectId: string) {
  const [project] = await db<{ template_version_id: string; overall_stage: string }[]>`
    SELECT w.template_version_id, p.overall_stage
    FROM commercial_projects p
    JOIN project_workflows w ON w.project_id = p.id
    WHERE p.id = ${projectId}
  `;
  if (!project) throw new Error(`missing project ${projectId}`);
  const nodes = await db<ProjectNode[]>`
    SELECT
      n.id,
      n.name,
      n.status,
      n.kind,
      n.is_optional,
      n.pos_x::float8 AS pos_x,
      n.pos_y::float8 AS pos_y,
      n.package_id,
      pkg.name AS package_name,
      n.template_node_id,
      to_char(n.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
    FROM wf_nodes n
    LEFT JOIN wf_packages pkg ON pkg.id = n.package_id AND pkg.workflow_id = n.workflow_id
    WHERE n.project_id = ${projectId}
    ORDER BY n.name, n.id
  `;
  const [edges] = await db<{ c: string }[]>`
    SELECT count(*)::text AS c
    FROM wf_edges e
    JOIN project_workflows w ON w.id = e.workflow_id
    WHERE w.project_id = ${projectId}
  `;
  const [packages] = await db<{ c: string }[]>`
    SELECT count(*)::text AS c
    FROM wf_packages pkg
    JOIN project_workflows w ON w.id = pkg.workflow_id
    WHERE w.project_id = ${projectId}
  `;
  return {
    templateVersionId: project.template_version_id,
    overallStage: project.overall_stage,
    nodes,
    edgeCount: Number(edges?.c ?? 0),
    packageCount: Number(packages?.c ?? 0),
  };
}
