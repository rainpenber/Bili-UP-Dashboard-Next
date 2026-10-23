import {
  commercialDisplayStateFromSource,
  isCommercialOriginKind,
  isOpenItemActor,
  isOpenItemImpact,
  isOpenItemLifecycle,
  isOverallStage,
  isPublishSource,
  isUuidString,
  isWfNodeKind,
  isWfNodeStatus,
  parseCommercialDefaultTemplate,
  parseCommercialProjectDetail,
  parseCommercialProjectList,
  parseCommercialProjectWorkflow,
  type CommercialOpenItemRead,
  type CommercialOriginKind,
  type CommercialProjectDetail,
  type CommercialProjectListItem,
  type CommercialProjectSourceSummary,
  type OverallStage,
  type PublishSource,
  type WfNodeKind,
  type WfNodeStatus,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import { Hono } from 'hono';
import { registerCommercialIngressRoutes } from './commercial-ingress';
import { COMMERCIAL_UPDATED_AT_FORMAT } from './commercial-timestamp';
import { registerCommercialWriteRoutes } from './commercial-write';

const DEFAULT_FLOW_SLUG = 'default_sponsorship';
const LIST_MAX_LIMIT = 200;

type ProjectCoreRow = {
  id: string;
  name: string;
  net_amount: string | null;
  rebate_amount: string | null;
  overall_stage: string;
  current_stage_names: string[] | null;
  blocked_node_names: string[] | null;
  any_node_blocked: boolean;
  blocking_reason: string | null;
  created_at: string;
  updated_at: string;
  user_deadline_at: string | null;
  blocked_since_at: string | null;
  archived_at: string | null;
  stage_entered_at: string;
  business_closed_at: string | null;
  origin_kind: string | null;
  source_namespace: string | null;
  source_id: string | null;
  source_updated_at: string | null;
  source_imported_at: string | null;
  source_content_hash: string | null;
  source_status: string | null;
  source_notes: string | null;
};

type OpenItemRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  close_criteria: string | null;
  next_action: string | null;
  next_actor: string;
  lifecycle: string;
  impact: string;
  planned_at: string | null;
  sort_rank: number;
  blocks_required_for_close: boolean;
  workflow_node_id: string | null;
  blocks_node_id: string | null;
  created_at: string;
  updated_at: string;
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

function openItemActor(value: string) {
  if (!isOpenItemActor(value)) throw new Error(`unexpected next_actor ${value}`);
  return value;
}

function openItemLifecycle(value: string) {
  if (!isOpenItemLifecycle(value)) throw new Error(`unexpected lifecycle ${value}`);
  return value;
}

function openItemImpact(value: string) {
  if (!isOpenItemImpact(value)) throw new Error(`unexpected impact ${value}`);
  return value;
}

function toOpenItem(row: OpenItemRow): CommercialOpenItemRead {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    closeCriteria: row.close_criteria,
    nextAction: row.next_action,
    nextActor: openItemActor(row.next_actor),
    lifecycle: openItemLifecycle(row.lifecycle),
    impact: openItemImpact(row.impact),
    plannedAt: row.planned_at,
    sortRank: row.sort_rank,
    blocksRequiredForClose: row.blocks_required_for_close,
    workflowNodeId: row.workflow_node_id,
    blocksNodeId: row.blocks_node_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function originKind(value: string | null): CommercialOriginKind | null {
  if (value === null) return null;
  if (!isCommercialOriginKind(value)) throw new Error(`unexpected origin_kind ${value}`);
  return value;
}

function toSourceSummary(row: ProjectCoreRow): CommercialProjectSourceSummary | null {
  if (
    row.source_namespace === null ||
    row.source_id === null ||
    row.source_updated_at === null ||
    row.source_imported_at === null ||
    row.source_content_hash === null
  ) {
    return null;
  }
  return {
    namespace: row.source_namespace,
    sourceId: row.source_id,
    sourceUpdatedAt: row.source_updated_at,
    importedAt: row.source_imported_at,
    contentHash: row.source_content_hash,
    sourceStatus: row.source_status,
    sourceNotes: row.source_notes,
  };
}

function toListItem(
  row: ProjectCoreRow,
  openItems: CommercialOpenItemRead[],
): CommercialProjectListItem {
  const source = toSourceSummary(row);
  const display = commercialDisplayStateFromSource(source);
  return {
    id: row.id,
    name: row.name,
    netAmount: moneyText(row.net_amount),
    rebateAmount: moneyText(row.rebate_amount),
    overallStage: overallStage(row.overall_stage),
    currentStageNames: stageNames(row.current_stage_names),
    anyNodeBlocked: row.any_node_blocked,
    blockingReason: row.blocking_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userDeadlineAt: row.user_deadline_at,
    blockedSinceAt: row.blocked_since_at,
    archivedAt: row.archived_at,
    stageEnteredAt: row.stage_entered_at,
    businessClosedAt: row.business_closed_at,
    originKind: originKind(row.origin_kind),
    source,
    businessState: display.businessState,
    originStatusLabel: display.originStatusLabel,
    blockedNodeNames: stageNames(row.blocked_node_names),
    openItems,
  };
}

type ProjectListQuery = {
  originKind: CommercialOriginKind | null;
  unclassifiedOnly: boolean;
  limit: number | null;
  offset: number;
};

function parseProjectListQuery(
  search: Record<string, string>,
): ProjectListQuery | { error: string } {
  const originRaw = search.originKind;
  let origin: CommercialOriginKind | null = null;
  let unclassifiedOnly = false;
  if (originRaw === 'unclassified') {
    unclassifiedOnly = true;
  } else if (originRaw !== undefined) {
    if (!isCommercialOriginKind(originRaw)) {
      return { error: 'originKind must be real, fixture, manual, or unclassified' };
    }
    origin = originRaw;
  }
  const limitRaw = search.limit;
  const offsetRaw = search.offset;
  let limit: number | null = null;
  let offset = 0;
  if (limitRaw !== undefined) {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > LIST_MAX_LIMIT) {
      return { error: `limit must be an integer from 1 to ${LIST_MAX_LIMIT}` };
    }
    limit = parsed;
  }
  if (offsetRaw !== undefined) {
    const parsed = Number(offsetRaw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { error: 'offset must be a non-negative integer' };
    }
    offset = parsed;
  }
  return { originKind: origin, unclassifiedOnly, limit, offset };
}

const BLOCKING_REASON_SQL = `
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
          )`;

async function readOpenItems(db: Sql, projectId: string | null): Promise<OpenItemRow[]> {
  if (projectId === null) {
    return db<OpenItemRow[]>`
      SELECT
        oi.id,
        oi.project_id,
        oi.title,
        oi.description,
        oi.close_criteria,
        oi.next_action,
        oi.next_actor,
        oi.lifecycle,
        oi.impact,
        to_char(oi.planned_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS planned_at,
        oi.sort_rank,
        oi.blocks_required_for_close,
        oi.workflow_node_id,
        oi.blocks_node_id,
        to_char(oi.created_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS created_at,
        to_char(oi.updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at
      FROM open_items oi
      ORDER BY oi.project_id ASC, oi.sort_rank ASC, oi.created_at ASC, oi.id ASC
    `;
  }
  return db<OpenItemRow[]>`
    SELECT
      oi.id,
      oi.project_id,
      oi.title,
      oi.description,
      oi.close_criteria,
      oi.next_action,
      oi.next_actor,
      oi.lifecycle,
      oi.impact,
      to_char(oi.planned_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS planned_at,
      oi.sort_rank,
      oi.blocks_required_for_close,
      oi.workflow_node_id,
      oi.blocks_node_id,
      to_char(oi.created_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS created_at,
      to_char(oi.updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at
    FROM open_items oi
    WHERE oi.project_id = ${projectId}
    ORDER BY oi.sort_rank ASC, oi.created_at ASC, oi.id ASC
  `;
}

function itemsByProject(rows: OpenItemRow[]): Map<string, CommercialOpenItemRead[]> {
  const grouped = new Map<string, CommercialOpenItemRead[]>();
  for (const row of rows) {
    const list = grouped.get(row.project_id) ?? [];
    list.push(toOpenItem(row));
    grouped.set(row.project_id, list);
  }
  return grouped;
}

async function readProjectCores(
  db: Sql,
  projectId: string | null,
  query: ProjectListQuery | null = null,
): Promise<{ rows: ProjectCoreRow[]; total: number }> {
  if (projectId !== null) {
    const rows = await db<ProjectCoreRow[]>`
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
        ARRAY(
          SELECT n.name
          FROM wf_nodes n
          WHERE n.project_id = p.id
            AND n.status = 'blocked'
          ORDER BY n.pos_y, n.pos_x, n.id
        ) AS blocked_node_names,
        EXISTS (
          SELECT 1 FROM wf_nodes n
          WHERE n.project_id = p.id AND n.status = 'blocked'
        ) AS any_node_blocked,
        ${db.unsafe(BLOCKING_REASON_SQL)} AS blocking_reason,
        to_char(p.created_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS created_at,
        to_char(p.updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at,
        to_char(p.user_deadline_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS user_deadline_at,
        to_char(p.blocked_since_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS blocked_since_at,
        to_char(p.archived_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS archived_at,
        to_char(p.stage_entered_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS stage_entered_at,
        to_char(p.business_closed_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS business_closed_at,
        p.origin_kind,
        s.namespace AS source_namespace,
        s.source_id AS source_id,
        to_char(s.source_updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS source_updated_at,
        to_char(s.imported_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS source_imported_at,
        s.content_hash AS source_content_hash,
        s.source_status AS source_status,
        s.source_notes AS source_notes
      FROM commercial_projects p
      LEFT JOIN commercial_project_sources s ON s.project_id = p.id
      WHERE p.id = ${projectId}
    `;
    return { rows, total: rows.length };
  }

  const originKindFilter = query?.originKind ?? null;
  const unclassifiedOnly = query?.unclassifiedOnly ?? false;
  const limit = query?.limit ?? null;
  const offset = query?.offset ?? 0;

  const [countRow] = await db<{ c: string }[]>`
    SELECT count(*)::text AS c
    FROM commercial_projects p
    WHERE (
      ${originKindFilter}::text IS NULL
      OR p.origin_kind = ${originKindFilter}
    )
    AND (
      ${unclassifiedOnly}::boolean = FALSE
      OR p.origin_kind IS NULL
    )
  `;
  const total = Number(countRow?.c ?? 0);

  const rows =
    limit === null
      ? await db<ProjectCoreRow[]>`
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
            ARRAY(
              SELECT n.name
              FROM wf_nodes n
              WHERE n.project_id = p.id
                AND n.status = 'blocked'
              ORDER BY n.pos_y, n.pos_x, n.id
            ) AS blocked_node_names,
            EXISTS (
              SELECT 1 FROM wf_nodes n
              WHERE n.project_id = p.id AND n.status = 'blocked'
            ) AS any_node_blocked,
            ${db.unsafe(BLOCKING_REASON_SQL)} AS blocking_reason,
            to_char(p.created_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS created_at,
            to_char(p.updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at,
            to_char(p.user_deadline_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS user_deadline_at,
            to_char(p.blocked_since_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS blocked_since_at,
            to_char(p.archived_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS archived_at,
            to_char(p.stage_entered_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS stage_entered_at,
            to_char(p.business_closed_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS business_closed_at,
            p.origin_kind,
            s.namespace AS source_namespace,
            s.source_id AS source_id,
            to_char(s.source_updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS source_updated_at,
            to_char(s.imported_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS source_imported_at,
            s.content_hash AS source_content_hash,
            s.source_status AS source_status,
            s.source_notes AS source_notes
          FROM commercial_projects p
          LEFT JOIN commercial_project_sources s ON s.project_id = p.id
          WHERE (
            ${originKindFilter}::text IS NULL
            OR p.origin_kind = ${originKindFilter}
          )
          AND (
            ${unclassifiedOnly}::boolean = FALSE
            OR p.origin_kind IS NULL
          )
          ORDER BY p.created_at ASC, p.id ASC
          OFFSET ${offset}
        `
      : await db<ProjectCoreRow[]>`
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
            ARRAY(
              SELECT n.name
              FROM wf_nodes n
              WHERE n.project_id = p.id
                AND n.status = 'blocked'
              ORDER BY n.pos_y, n.pos_x, n.id
            ) AS blocked_node_names,
            EXISTS (
              SELECT 1 FROM wf_nodes n
              WHERE n.project_id = p.id AND n.status = 'blocked'
            ) AS any_node_blocked,
            ${db.unsafe(BLOCKING_REASON_SQL)} AS blocking_reason,
            to_char(p.created_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS created_at,
            to_char(p.updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at,
            to_char(p.user_deadline_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS user_deadline_at,
            to_char(p.blocked_since_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS blocked_since_at,
            to_char(p.archived_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS archived_at,
            to_char(p.stage_entered_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS stage_entered_at,
            to_char(p.business_closed_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS business_closed_at,
            p.origin_kind,
            s.namespace AS source_namespace,
            s.source_id AS source_id,
            to_char(s.source_updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS source_updated_at,
            to_char(s.imported_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS source_imported_at,
            s.content_hash AS source_content_hash,
            s.source_status AS source_status,
            s.source_notes AS source_notes
          FROM commercial_projects p
          LEFT JOIN commercial_project_sources s ON s.project_id = p.id
          WHERE (
            ${originKindFilter}::text IS NULL
            OR p.origin_kind = ${originKindFilter}
          )
          AND (
            ${unclassifiedOnly}::boolean = FALSE
            OR p.origin_kind IS NULL
          )
          ORDER BY p.created_at ASC, p.id ASC
          LIMIT ${limit}
          OFFSET ${offset}
        `;

  return { rows, total };
}

export function createCommercialRoutes(db: Sql) {
  const app = new Hono();

  app.get('/projects', async (c) => {
    try {
      const parsedQuery = parseProjectListQuery(c.req.query());
      if ('error' in parsedQuery) return c.json({ error: parsedQuery.error }, 400);
      const { rows, total } = await readProjectCores(db, null, parsedQuery);
      const grouped = itemsByProject(await readOpenItems(db, null));
      return c.json(
        parseCommercialProjectList({
          items: rows.map((row) => toListItem(row, grouped.get(row.id) ?? [])),
          total,
          limit: parsedQuery.limit,
          offset: parsedQuery.offset,
        }),
      );
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
        {
          id: string;
          name: string;
          status: string;
          kind: string;
          template_slug: string | null;
          blocking_reason: string | null;
          planned_at: string | null;
          completed_at: string | null;
          updated_at: string;
        }[]
      >`
        SELECT
          n.id,
          n.name,
          n.status,
          n.kind,
          t.slug AS template_slug,
          (
            SELECT oi.title
            FROM open_items oi
            WHERE n.status = 'blocked'
              AND oi.project_id = n.project_id
              AND oi.lifecycle = 'open'
              AND oi.impact = 'blocking'
              AND (
                oi.id = n.primary_block_pinned_item_id
                OR oi.blocks_node_id = n.id
              )
            ORDER BY
              (oi.id = n.primary_block_pinned_item_id) DESC,
              oi.sort_rank ASC,
              oi.created_at ASC,
              oi.id ASC
            LIMIT 1
          ) AS blocking_reason,
          to_char(n.planned_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS planned_at,
          to_char(n.completed_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS completed_at,
          to_char(n.updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at
        FROM wf_nodes n
        LEFT JOIN wf_template_nodes t ON t.id = n.template_node_id
        WHERE n.workflow_id = ${workflow.id}
        ORDER BY n.pos_y, n.pos_x, n.id
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
            templateSlug: node.template_slug,
            blockingReason: node.blocking_reason,
            plannedAt: node.planned_at,
            completedAt: node.completed_at,
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
      const { rows } = await readProjectCores(db, projectId);
      const row = rows[0];
      if (!row) return c.json({ error: 'project not found' }, 404);
      const publishes = await db<
        {
          bvid: string | null;
          published_at: Date | null;
          publish_source: string | null;
          idempotency_key: string | null;
        }[]
      >`
        SELECT bvid, published_at, publish_source, idempotency_key
        FROM project_publish_records
        WHERE project_id = ${projectId}
      `;
      const publishRow = publishes[0];
      const grouped = itemsByProject(await readOpenItems(db, projectId));
      const detail: CommercialProjectDetail = {
        ...toListItem(row, grouped.get(projectId) ?? []),
        publish:
          publishRow === undefined
            ? {
                published: false,
                bvid: null,
                publishedAt: null,
                publishSource: null,
                idempotencyKey: null,
              }
            : {
                published: true,
                bvid: publishRow.bvid ?? '',
                publishedAt: toIso(publishRow.published_at ?? ''),
                publishSource: publishSource(publishRow.publish_source ?? ''),
                idempotencyKey: publishRow.idempotency_key ?? '',
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

  registerCommercialWriteRoutes(app, db);
  registerCommercialIngressRoutes(app, db);
  return app;
}
