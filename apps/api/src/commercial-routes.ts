import {
  isOverallStage,
  isPublishSource,
  isUuidString,
  isWfNodeKind,
  isWfNodeStatus,
  parseCommercialDefaultTemplate,
  parseCommercialProjectDetail,
  parseCommercialProjectList,
  parseCommercialProjectWorkflow,
  type CommercialProjectDetail,
  type CommercialProjectListItem,
  type OverallStage,
  type PublishSource,
  type WfNodeKind,
  type WfNodeStatus,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import { Hono } from 'hono';
import { COMMERCIAL_UPDATED_AT_FORMAT } from './commercial-timestamp';
import { DEFAULT_TEMPLATE_SLUG, registerCommercialTemplateRoutes } from './commercial-template';
import { registerCommercialWriteRoutes } from './commercial-write';

const DEFAULT_FLOW_SLUG = DEFAULT_TEMPLATE_SLUG;

type ProjectCoreRow = {
  id: string;
  name: string;
  net_amount: string | null;
  rebate_amount: string | null;
  overall_stage: string;
  current_stage_names: string[] | null;
  any_node_blocked: boolean;
};

function moneyText(value: string | null): string | null {
  if (value === null) return null;
  return value;
}

function overallStage(value: string): OverallStage {
  if (!isOverallStage(value)) throw new Error(`unexpected overall_stage ${value}`);
  return value;
}

function nodeStatus(value: string): WfNodeStatus {
  if (!isWfNodeStatus(value)) throw new Error(`unexpected node status ${value}`);
  return value;
}

function nodeKind(value: string): WfNodeKind {
  if (!isWfNodeKind(value)) throw new Error(`unexpected node kind ${value}`);
  return value;
}

function publishSource(value: string): PublishSource {
  if (!isPublishSource(value)) throw new Error(`unexpected publish_source ${value}`);
  return value;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid timestamp');
  return date.toISOString();
}

function stageNames(value: string[] | null): string[] {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error('current stage names must be an array');
  return value;
}

function toListItem(row: ProjectCoreRow): CommercialProjectListItem {
  return {
    id: row.id,
    name: row.name,
    netAmount: moneyText(row.net_amount),
    rebateAmount: moneyText(row.rebate_amount),
    overallStage: overallStage(row.overall_stage),
    currentStageNames: stageNames(row.current_stage_names),
    anyNodeBlocked: row.any_node_blocked,
  };
}

async function readProjectCores(db: Sql, projectId: string | null): Promise<ProjectCoreRow[]> {
  if (projectId === null) {
    return db<ProjectCoreRow[]>`
      SELECT
        p.id,
        p.name,
        p.net_amount::text AS net_amount,
        p.rebate_amount::text AS rebate_amount,
        p.overall_stage,
        ARRAY(
          SELECT n.name
          FROM wf_nodes n
          WHERE n.project_id = p.id
            AND n.status IN ('in_progress', 'blocked')
          ORDER BY n.pos_y, n.pos_x, n.id
        ) AS current_stage_names,
        EXISTS (
          SELECT 1 FROM wf_nodes n
          WHERE n.project_id = p.id AND n.status = 'blocked'
        ) AS any_node_blocked
      FROM commercial_projects p
      ORDER BY p.created_at ASC, p.id ASC
    `;
  }
  return db<ProjectCoreRow[]>`
    SELECT
      p.id,
      p.name,
      p.net_amount::text AS net_amount,
      p.rebate_amount::text AS rebate_amount,
      p.overall_stage,
      ARRAY(
        SELECT n.name
        FROM wf_nodes n
        WHERE n.project_id = p.id
          AND n.status IN ('in_progress', 'blocked')
        ORDER BY n.pos_y, n.pos_x, n.id
      ) AS current_stage_names,
      EXISTS (
        SELECT 1 FROM wf_nodes n
        WHERE n.project_id = p.id AND n.status = 'blocked'
      ) AS any_node_blocked
    FROM commercial_projects p
    WHERE p.id = ${projectId}
  `;
}

export function createCommercialRoutes(db: Sql) {
  const app = new Hono();

  app.get('/projects', async (c) => {
    try {
      const rows = await readProjectCores(db, null);
      return c.json(parseCommercialProjectList({ items: rows.map((row) => toListItem(row)) }));
    } catch (err) {
      console.error(err);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  app.get('/projects/:projectId/workflow', async (c) => {
    const projectId = c.req.param('projectId');
    if (!isUuidString(projectId)) return c.json({ error: 'invalid project id' }, 400);
    try {
      const projects = await db<{ id: string }[]>`
        SELECT id FROM commercial_projects WHERE id = ${projectId}
      `;
      if (projects.length === 0) return c.json({ error: 'project not found' }, 404);
      const workflows = await db<{ id: string; template_version_id: string }[]>`
        SELECT id, template_version_id FROM project_workflows WHERE project_id = ${projectId}
      `;
      const workflow = workflows[0];
      if (!workflow) return c.json({ error: 'workflow not found' }, 404);
      const nodes = await db<
        { id: string; name: string; status: string; kind: string; updated_at: string }[]
      >`
        SELECT
          id,
          name,
          status,
          kind,
          to_char(updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at
        FROM wf_nodes
        WHERE workflow_id = ${workflow.id}
        ORDER BY pos_y, pos_x, id
      `;
      const edges = await db<{ id: string; from_node_id: string; to_node_id: string }[]>`
        SELECT e.id, e.from_node_id, e.to_node_id
        FROM wf_edges e
        JOIN wf_nodes fn ON fn.id = e.from_node_id AND fn.workflow_id = e.workflow_id
        JOIN wf_nodes tn ON tn.id = e.to_node_id AND tn.workflow_id = e.workflow_id
        WHERE e.workflow_id = ${workflow.id}
        ORDER BY fn.pos_y, fn.pos_x, fn.id, tn.pos_y, tn.pos_x, tn.id, e.id
      `;
      return c.json(
        parseCommercialProjectWorkflow({
          projectId,
          workflowId: workflow.id,
          templateVersionId: workflow.template_version_id,
          nodes: nodes.map((node) => ({
            id: node.id,
            name: node.name,
            status: nodeStatus(node.status),
            kind: nodeKind(node.kind),
            updatedAt: node.updated_at,
          })),
          edges: edges.map((edge) => ({
            id: edge.id,
            fromNodeId: edge.from_node_id,
            toNodeId: edge.to_node_id,
          })),
        }),
      );
    } catch (err) {
      console.error(err);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  app.get('/projects/:projectId', async (c) => {
    const projectId = c.req.param('projectId');
    if (!isUuidString(projectId)) return c.json({ error: 'invalid project id' }, 400);
    try {
      const rows = await db<
        (ProjectCoreRow & {
          blocking_reason: string | null;
          bvid: string | null;
          published_at: Date | null;
          publish_source: string | null;
        })[]
      >`
        SELECT
          p.id,
          p.name,
          p.net_amount::text AS net_amount,
          p.rebate_amount::text AS rebate_amount,
          p.overall_stage,
          ARRAY(
            SELECT n.name
            FROM wf_nodes n
            WHERE n.project_id = p.id
              AND n.status IN ('in_progress', 'blocked')
            ORDER BY n.pos_y, n.pos_x, n.id
          ) AS current_stage_names,
          EXISTS (
            SELECT 1 FROM wf_nodes n
            WHERE n.project_id = p.id AND n.status = 'blocked'
          ) AS any_node_blocked,
          (
            SELECT oi.title
            FROM open_items oi
            WHERE oi.project_id = p.id
              AND oi.lifecycle = 'open'
              AND oi.impact = 'blocking'
              AND (
                EXISTS (
                  SELECT 1 FROM wf_nodes n
                  WHERE n.project_id = p.id
                    AND n.status = 'blocked'
                    AND n.primary_block_pinned_item_id = oi.id
                )
                OR EXISTS (
                  SELECT 1 FROM wf_nodes n
                  WHERE n.id = oi.blocks_node_id
                    AND n.project_id = p.id
                    AND n.status = 'blocked'
                )
              )
            ORDER BY
              (
                EXISTS (
                  SELECT 1 FROM wf_nodes n
                  WHERE n.project_id = p.id
                    AND n.status = 'blocked'
                    AND n.primary_block_pinned_item_id = oi.id
                )
              ) DESC,
              oi.sort_rank ASC,
              oi.created_at ASC,
              oi.id ASC
            LIMIT 1
          ) AS blocking_reason,
          r.bvid,
          r.published_at,
          r.publish_source
        FROM commercial_projects p
        LEFT JOIN project_publish_records r ON r.project_id = p.id
        WHERE p.id = ${projectId}
      `;
      const row = rows[0];
      if (!row) return c.json({ error: 'project not found' }, 404);
      const detail: CommercialProjectDetail = {
        ...toListItem(row),
        blockingReason: row.blocking_reason,
        publish:
          row.bvid === null
            ? { published: false, bvid: null, publishedAt: null, publishSource: null }
            : {
                published: true,
                bvid: row.bvid,
                publishedAt: toIso(row.published_at ?? ''),
                publishSource: publishSource(row.publish_source ?? ''),
              },
      };
      return c.json(parseCommercialProjectDetail(detail));
    } catch (err) {
      console.error(err);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  app.get('/templates/default', async (c) => {
    try {
      const versions = await db<
        { id: string; slug: string; name: string; version: number; published_at: Date }[]
      >`
        SELECT id, slug, name, version, published_at
        FROM wf_template_versions
        WHERE slug = ${DEFAULT_FLOW_SLUG} AND is_default = TRUE AND is_draft = FALSE
      `;
      const version = versions[0];
      if (!version) return c.json({ error: 'default template not found' }, 404);
      const nodes = await db<
        { id: string; slug: string; name: string; kind: string; is_optional: boolean }[]
      >`
        SELECT id, slug, name, kind, is_optional
        FROM wf_template_nodes
        WHERE template_version_id = ${version.id}
        ORDER BY pos_y, pos_x, id
      `;
      const edges = await db<{ id: string; from_node_id: string; to_node_id: string }[]>`
        SELECT e.id, e.from_node_id, e.to_node_id
        FROM wf_template_edges e
        JOIN wf_template_nodes fn
          ON fn.id = e.from_node_id AND fn.template_version_id = e.template_version_id
        JOIN wf_template_nodes tn
          ON tn.id = e.to_node_id AND tn.template_version_id = e.template_version_id
        WHERE e.template_version_id = ${version.id}
        ORDER BY fn.pos_y, fn.pos_x, fn.id, tn.pos_y, tn.pos_x, tn.id, e.id
      `;
      return c.json(
        parseCommercialDefaultTemplate({
          id: version.id,
          slug: version.slug,
          name: version.name,
          version: version.version,
          publishedAt: toIso(version.published_at),
          nodes: nodes.map((node) => ({
            id: node.id,
            slug: node.slug,
            name: node.name,
            kind: nodeKind(node.kind),
            isOptional: node.is_optional,
          })),
          edges: edges.map((edge) => ({
            id: edge.id,
            fromNodeId: edge.from_node_id,
            toNodeId: edge.to_node_id,
          })),
        }),
      );
    } catch (err) {
      console.error(err);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  registerCommercialTemplateRoutes(app, db);
  registerCommercialWriteRoutes(app, db);
  return app;
}
