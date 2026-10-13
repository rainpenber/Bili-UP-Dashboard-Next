import type {
  CreateOpenItemBody,
  DashboardTodayResponse,
  HermesChangeProposal,
  OpenItemDto,
  PatchOpenItemBody,
  PatchProjectBody,
  PatchWorkflowNodeBody,
  ProjectSummary,
  ProjectWorkflowResponse,
  TeamMember,
  WorkflowNodeDto,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import type postgres from 'postgres';

type DbExecutor = Sql | postgres.TransactionSql;
import {
  assertValidNodeTransition,
  deriveHealthStatus,
  deriveProjectStage,
  downstreamNodeIds,
  recomputeAfterManualChange,
  TransitionError,
  type WorkflowDependency,
  type WorkflowNodeSnapshot,
} from '@studio/workflow';

const TEMPLATE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type MemberRow = { id: string; display_name: string; role_labels: string[] };

function mapMember(row: MemberRow | undefined): TeamMember | null {
  if (!row) return null;
  return { id: row.id, displayName: row.display_name, roleLabels: row.role_labels };
}

async function loadMembers(sql: Sql, ids: string[]): Promise<Map<string, TeamMember>> {
  if (ids.length === 0) return new Map();
  const rows = await sql<MemberRow[]>`
    SELECT id, display_name, role_labels FROM team_members WHERE id = ANY(${ids}::uuid[])
  `;
  return new Map(rows.map((r) => [r.id, mapMember(r)!]));
}

export class ProjectService {
  constructor(
    private readonly sql: Sql,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listTeamMembers(): Promise<TeamMember[]> {
    const rows = await this.sql<MemberRow[]>`
      SELECT id, display_name, role_labels FROM team_members ORDER BY display_name
    `;
    return rows.map((r) => mapMember(r)!);
  }

  async listProjects(query: {
    page: number;
    pageSize: number;
    stage?: string | undefined;
    ownerId?: string | undefined;
    risk?: 'blocked' | 'at_risk' | 'any' | undefined;
    dueBefore?: string | undefined;
    includeArchived?: boolean | undefined;
  }): Promise<{ items: ProjectSummary[]; totalItems: number }> {
    const offset = (query.page - 1) * query.pageSize;
    const risk = query.risk ?? 'any';
    const includeArchived = query.includeArchived ?? false;
    const stage = query.stage ?? null;
    const ownerId = query.ownerId ?? null;
    const dueBefore = query.dueBefore ?? null;
    const countRows = await this.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM projects p
      WHERE (${includeArchived} OR p.archived_at IS NULL)
      AND (${stage}::text IS NULL OR p.derived_stage = ${stage})
      AND (${ownerId}::uuid IS NULL OR p.owner_id = ${ownerId})
      AND (
        ${risk} = 'any'
        OR (${risk} = 'blocked' AND p.health_status = 'blocked')
        OR (${risk} = 'at_risk' AND p.health_status = 'at_risk')
      )
      AND (${dueBefore}::timestamptz IS NULL OR p.planned_publish_at <= ${dueBefore})
    `;
    const totalItems = Number(countRows[0]?.count ?? '0');
    const rows = await this.sql<
      {
        id: string;
        name: string;
        brand: string | null;
        product: string | null;
        cooperation_type: string | null;
        derived_stage: string;
        planned_publish_at: Date | null;
        owner_id: string | null;
        health_status: string;
        source_status: string;
        archived_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }[]
    >`
      SELECT * FROM projects p
      WHERE (${includeArchived} OR p.archived_at IS NULL)
      AND (${stage}::text IS NULL OR p.derived_stage = ${stage})
      AND (${ownerId}::uuid IS NULL OR p.owner_id = ${ownerId})
      AND (
        ${risk} = 'any'
        OR (${risk} = 'blocked' AND p.health_status = 'blocked')
        OR (${risk} = 'at_risk' AND p.health_status = 'at_risk')
      )
      AND (${dueBefore}::timestamptz IS NULL OR p.planned_publish_at <= ${dueBefore})
      ORDER BY p.updated_at DESC
      LIMIT ${query.pageSize} OFFSET ${offset}
    `;
    const items = await Promise.all(rows.map((r) => this.hydrateProjectSummary(r)));
    return { items, totalItems };
  }

  private async hydrateProjectSummary(row: {
    id: string;
    name: string;
    brand: string | null;
    product: string | null;
    cooperation_type: string | null;
    derived_stage: string;
    planned_publish_at: Date | null;
    owner_id: string | null;
    health_status: string;
    source_status: string;
    archived_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }): Promise<ProjectSummary> {
    const ownerMap = await loadMembers(this.sql, row.owner_id ? [row.owner_id] : []);
    const openCountRows = await this.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM open_items WHERE project_id = ${row.id} AND status = 'open'
    `;
    const blockRows = await this.sql<{ blocked_reason: string | null }[]>`
      SELECT wn.blocked_reason FROM workflow_nodes wn
      JOIN project_workflows pw ON pw.id = wn.project_workflow_id
      WHERE pw.project_id = ${row.id} AND wn.status IN ('blocked', 'waiting_external')
      ORDER BY wn.sort_order LIMIT 1
    `;
    const nextRows = await this.sql<{ label: string }[]>`
      SELECT label FROM workflow_nodes wn
      JOIN project_workflows pw ON pw.id = wn.project_workflow_id
      WHERE pw.project_id = ${row.id} AND wn.status IN ('ready', 'in_progress', 'waiting_external', 'blocked')
      ORDER BY wn.sort_order LIMIT 1
    `;
    return {
      id: row.id,
      name: row.name,
      brand: row.brand,
      product: row.product,
      cooperationType: row.cooperation_type,
      derivedStage: row.derived_stage as ProjectSummary['derivedStage'],
      plannedPublishAt: row.planned_publish_at?.toISOString() ?? null,
      owner: row.owner_id ? (ownerMap.get(row.owner_id) ?? null) : null,
      healthStatus: row.health_status as ProjectSummary['healthStatus'],
      sourceStatus: row.source_status as ProjectSummary['sourceStatus'],
      archivedAt: row.archived_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      openItemCount: Number(openCountRows[0]?.count ?? '0'),
      primaryBlockReason: blockRows[0]?.blocked_reason ?? null,
      nextStepLabel: nextRows[0]?.label ?? null,
    };
  }

  async getProject(id: string): Promise<ProjectSummary | null> {
    const rows = await this.sql<
      {
        id: string;
        name: string;
        brand: string | null;
        product: string | null;
        cooperation_type: string | null;
        derived_stage: string;
        planned_publish_at: Date | null;
        owner_id: string | null;
        health_status: string;
        source_status: string;
        archived_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }[]
    >`SELECT * FROM projects WHERE id = ${id}`;
    const row = rows[0];
    if (!row) return null;
    return this.hydrateProjectSummary(row);
  }

  async createProject(body: {
    name: string;
    brand?: string;
    product?: string;
    cooperationType?: string;
    plannedPublishAt?: string;
    ownerId?: string;
    sourceStatus?: string;
  }): Promise<ProjectSummary> {
    const id = crypto.randomUUID();
    await this.sql.begin(async (tx) => {
      await tx`
        INSERT INTO projects (
          id, name, brand, product, cooperation_type, planned_publish_at, owner_id, source_status
        ) VALUES (
          ${id}, ${body.name}, ${body.brand ?? null}, ${body.product ?? null},
          ${body.cooperationType ?? null}, ${body.plannedPublishAt ?? null},
          ${body.ownerId ?? null}, ${body.sourceStatus ?? 'unknown'}
        )
      `;
      await this.instantiateStandardWorkflow(tx as unknown as DbExecutor, id);
    });
    const created = await this.getProject(id);
    if (!created) throw new Error('create failed');
    return created;
  }

  private async instantiateStandardWorkflow(tx: DbExecutor, projectId: string): Promise<void> {
    const workflowId = crypto.randomUUID();
    await tx`
      INSERT INTO project_workflows (id, project_id, template_id)
      VALUES (${workflowId}, ${projectId}, ${TEMPLATE_ID})
    `;
    const templateNodes = await tx<
      {
        id: string;
        slug: string;
        label: string;
        sort_order: number;
        is_required: boolean;
        dependency_mode: string;
        completion_criteria: string | null;
        stage_key: string | null;
      }[]
    >`
      SELECT id, slug, label, sort_order, is_required, dependency_mode, completion_criteria, stage_key
      FROM workflow_template_nodes WHERE template_id = ${TEMPLATE_ID} ORDER BY sort_order
    `;
    const idMap = new Map<string, string>();
    for (const tn of templateNodes) {
      const nodeId = crypto.randomUUID();
      idMap.set(tn.id, nodeId);
      const status = tn.sort_order === 10 ? 'ready' : 'locked';
      await tx`
        INSERT INTO workflow_nodes (
          id, project_workflow_id, template_node_id, slug, label, sort_order, is_required,
          dependency_mode, completion_criteria, stage_key, status
        ) VALUES (
          ${nodeId}, ${workflowId}, ${tn.id}, ${tn.slug}, ${tn.label}, ${tn.sort_order},
          ${tn.is_required}, ${tn.dependency_mode}, ${tn.completion_criteria}, ${tn.stage_key}, ${status}
        )
      `;
    }
    const templateDeps = await tx<{ node_id: string; depends_on_node_id: string }[]>`
      SELECT node_id, depends_on_node_id FROM workflow_template_node_dependencies
      WHERE node_id IN (SELECT id FROM workflow_template_nodes WHERE template_id = ${TEMPLATE_ID})
    `;
    for (const d of templateDeps) {
      const nodeId = idMap.get(d.node_id);
      const predId = idMap.get(d.depends_on_node_id);
      if (!nodeId || !predId) continue;
      await tx`
        INSERT INTO workflow_node_dependencies (node_id, depends_on_node_id)
        VALUES (${nodeId}, ${predId})
      `;
    }
    await this.syncProjectDerivedState(tx, projectId);
  }

  async patchProject(id: string, body: PatchProjectBody): Promise<ProjectSummary | null> {
    const existing = await this.getProject(id);
    if (!existing) return null;
    await this.sql`
      UPDATE projects SET
        name = COALESCE(${body.name ?? null}, name),
        brand = COALESCE(${body.brand ?? null}, brand),
        product = COALESCE(${body.product ?? null}, product),
        cooperation_type = COALESCE(${body.cooperationType ?? null}, cooperation_type),
        planned_publish_at = COALESCE(${body.plannedPublishAt ?? null}::timestamptz, planned_publish_at),
        owner_id = COALESCE(${body.ownerId ?? null}::uuid, owner_id),
        source_status = COALESCE(${body.sourceStatus ?? null}, source_status),
        updated_at = now()
      WHERE id = ${id}
    `;
    return this.getProject(id);
  }

  async archiveProject(id: string): Promise<ProjectSummary | null> {
    await this.sql`
      UPDATE projects SET archived_at = now(), updated_at = now() WHERE id = ${id} AND archived_at IS NULL
    `;
    return this.getProject(id);
  }

  async restoreProject(id: string): Promise<ProjectSummary | null> {
    await this.sql`
      UPDATE projects SET archived_at = NULL, updated_at = now() WHERE id = ${id}
    `;
    return this.getProject(id);
  }

  private async loadWorkflowGraph(projectId: string): Promise<{
    workflowId: string;
    nodes: WorkflowNodeSnapshot[];
    deps: WorkflowDependency[];
    rawNodes: WorkflowNodeDto[];
  } | null> {
    const wfRows = await this.sql<{ id: string; template_slug: string }[]>`
      SELECT pw.id, wt.slug AS template_slug
      FROM project_workflows pw
      JOIN workflow_templates wt ON wt.id = pw.template_id
      WHERE pw.project_id = ${projectId}
    `;
    const wf = wfRows[0];
    if (!wf) return null;
    const rows = await this.sql<
      {
        id: string;
        slug: string;
        label: string;
        parent_id: string | null;
        sort_order: number;
        is_required: boolean;
        dependency_mode: 'all_of' | 'any_of';
        status: WorkflowNodeSnapshot['status'];
        owner_id: string | null;
        due_at: Date | null;
        completion_criteria: string | null;
        blocked_reason: string | null;
        stage_key: string | null;
        status_changed_at: Date;
        completed_at: Date | null;
      }[]
    >`
      SELECT * FROM workflow_nodes WHERE project_workflow_id = ${wf.id} ORDER BY sort_order
    `;
    const depRows = await this.sql<{ node_id: string; depends_on_node_id: string }[]>`
      SELECT d.node_id, d.depends_on_node_id FROM workflow_node_dependencies d
      JOIN workflow_nodes n ON n.id = d.node_id
      WHERE n.project_workflow_id = ${wf.id}
    `;
    const ownerIds = rows.map((r) => r.owner_id).filter(Boolean) as string[];
    const owners = await loadMembers(this.sql, ownerIds);
    const deps: WorkflowDependency[] = depRows.map((d) => ({
      nodeId: d.node_id,
      dependsOnId: d.depends_on_node_id,
    }));
    const snapshots: WorkflowNodeSnapshot[] = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      parentId: r.parent_id,
      sortOrder: r.sort_order,
      isRequired: r.is_required,
      dependencyMode: r.dependency_mode,
      status: r.status,
      stageKey: r.stage_key,
      blockedReason: r.blocked_reason,
    }));
    const { blockedBy } = recomputeAfterManualChange(snapshots, deps);
    const rawNodes: WorkflowNodeDto[] = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      label: r.label,
      parentId: r.parent_id,
      sortOrder: r.sort_order,
      isRequired: r.is_required,
      dependencyMode: r.dependency_mode,
      status: r.status,
      owner: r.owner_id ? (owners.get(r.owner_id) ?? null) : null,
      dueAt: r.due_at?.toISOString() ?? null,
      completionCriteria: r.completion_criteria,
      blockedReason: r.blocked_reason,
      stageKey: r.stage_key,
      blockedByNodeIds: blockedBy.get(r.id) ?? [],
      dependencyNodeIds: deps.filter((d) => d.nodeId === r.id).map((d) => d.dependsOnId),
      statusChangedAt: r.status_changed_at.toISOString(),
      completedAt: r.completed_at?.toISOString() ?? null,
    }));
    return { workflowId: wf.id, nodes: snapshots, deps, rawNodes };
  }

  async getWorkflow(projectId: string): Promise<ProjectWorkflowResponse | null> {
    const graph = await this.loadWorkflowGraph(projectId);
    if (!graph) return null;
    const history = await this.sql<
      {
        id: string;
        node_id: string;
        from_status: string | null;
        to_status: string;
        changed_at: Date;
        note: string | null;
      }[]
    >`
      SELECT h.* FROM workflow_node_status_history h
      JOIN workflow_nodes n ON n.id = h.node_id
      WHERE n.project_workflow_id = ${graph.workflowId}
      ORDER BY h.changed_at DESC LIMIT 30
    `;
    return {
      projectId,
      workflowId: graph.workflowId,
      templateSlug: 'standard_sponsorship',
      nodes: graph.rawNodes,
      recentHistory: history.map((h) => ({
        id: String(h.id),
        nodeId: h.node_id,
        fromStatus: h.from_status,
        toStatus: h.to_status,
        changedAt: h.changed_at.toISOString(),
        note: h.note,
      })),
    };
  }

  async patchWorkflowNode(
    projectId: string,
    nodeId: string,
    body: PatchWorkflowNodeBody,
  ): Promise<ProjectWorkflowResponse | null> {
    const graph = await this.loadWorkflowGraph(projectId);
    if (!graph) return null;
    const node = graph.rawNodes.find((n) => n.id === nodeId);
    if (!node) return null;

    await this.sql.begin(async (tx) => {
      const current = await tx<{ status: WorkflowNodeSnapshot['status'] }[]>`
        SELECT status FROM workflow_nodes WHERE id = ${nodeId} FOR UPDATE
      `;
      const fromStatus = current[0]?.status;
      if (!fromStatus) throw new Error('node missing');
      if (body.status && body.status !== fromStatus) {
        try {
          assertValidNodeTransition(fromStatus, body.status);
        } catch (err) {
          if (err instanceof TransitionError) {
            const e = new Error(err.message);
            (e as Error & { status: number }).status = 409;
            throw e;
          }
          throw err;
        }
      }
      const nextStatus = body.status ?? fromStatus;
      const nextOwnerId = body.ownerId !== undefined ? body.ownerId : (node.owner?.id ?? null);
      const nextDueAt = body.dueAt !== undefined ? body.dueAt : node.dueAt;
      const nextBlockedReason =
        body.blockedReason !== undefined ? body.blockedReason : node.blockedReason;
      const statusChanged = nextStatus !== fromStatus;
      const nextCompletedAt =
        nextStatus === 'completed'
          ? new Date()
          : statusChanged
            ? null
            : node.completedAt
              ? new Date(node.completedAt)
              : null;
      await tx`
        UPDATE workflow_nodes SET
          status = ${nextStatus},
          owner_id = ${nextOwnerId},
          due_at = ${nextDueAt},
          blocked_reason = ${nextBlockedReason},
          status_changed_at = ${statusChanged ? new Date() : new Date(node.statusChangedAt)},
          completed_at = ${nextCompletedAt}
        WHERE id = ${nodeId}
      `;
      if (body.status && body.status !== fromStatus) {
        await tx`
          INSERT INTO workflow_node_status_history (node_id, from_status, to_status)
          VALUES (${nodeId}, ${fromStatus}, ${body.status})
        `;
      }
      const refreshed = await this.loadWorkflowGraphTx(tx as unknown as DbExecutor, projectId);
      if (!refreshed) return;
      const recompute = recomputeAfterManualChange(refreshed.nodes, refreshed.deps);
      for (const [id, status] of recompute.statusUpdates) {
        await tx`
          UPDATE workflow_nodes SET status = ${status}, status_changed_at = now()
          WHERE id = ${id}
        `;
      }
      await this.syncProjectDerivedState(tx as unknown as DbExecutor, projectId);
    });

    return this.getWorkflow(projectId);
  }

  private async loadWorkflowGraphTx(tx: DbExecutor, projectId: string) {
    const wfRows = await tx<{ id: string }[]>`
      SELECT id FROM project_workflows WHERE project_id = ${projectId}
    `;
    const wfId = wfRows[0]?.id;
    if (!wfId) return null;
    const rows = await tx<
      {
        id: string;
        slug: string;
        parent_id: string | null;
        sort_order: number;
        is_required: boolean;
        dependency_mode: 'all_of' | 'any_of';
        status: WorkflowNodeSnapshot['status'];
        stage_key: string | null;
        blocked_reason: string | null;
      }[]
    >`SELECT id, slug, parent_id, sort_order, is_required, dependency_mode, status, stage_key, blocked_reason
       FROM workflow_nodes WHERE project_workflow_id = ${wfId}`;
    const depRows = await tx<{ node_id: string; depends_on_node_id: string }[]>`
      SELECT node_id, depends_on_node_id FROM workflow_node_dependencies d
      JOIN workflow_nodes n ON n.id = d.node_id WHERE n.project_workflow_id = ${wfId}
    `;
    return {
      nodes: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        parentId: r.parent_id,
        sortOrder: r.sort_order,
        isRequired: r.is_required,
        dependencyMode: r.dependency_mode,
        status: r.status,
        stageKey: r.stage_key,
        blockedReason: r.blocked_reason,
      })),
      deps: depRows.map((d) => ({ nodeId: d.node_id, dependsOnId: d.depends_on_node_id })),
    };
  }

  private async syncProjectDerivedState(tx: DbExecutor, projectId: string): Promise<void> {
    const graph = await this.loadWorkflowGraphTx(tx, projectId);
    if (!graph) return;
    const stage = deriveProjectStage(graph.nodes);
    const openRows = await tx<{ count: string; overdue: string }[]>`
      SELECT
        count(*) FILTER (WHERE status = 'open')::text AS count,
        count(*) FILTER (WHERE status = 'open' AND due_at < now())::text AS overdue
      FROM open_items WHERE project_id = ${projectId}
    `;
    const hasOur = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM open_items
      WHERE project_id = ${projectId} AND status = 'open' AND responsible_party = 'us'
    `;
    const health = deriveHealthStatus(
      graph.nodes,
      Number(hasOur[0]?.count ?? '0') > 0,
      Number(openRows[0]?.overdue ?? '0') > 0,
    );
    await tx`
      UPDATE projects SET derived_stage = ${stage}, health_status = ${health}, updated_at = now()
      WHERE id = ${projectId}
    `;
  }

  async listOpenItems(projectId: string): Promise<OpenItemDto[]> {
    const rows = await this.sql<
      {
        id: string;
        project_id: string;
        workflow_node_id: string | null;
        item_type: string;
        status: string;
        responsible_party: string;
        due_at: Date | null;
        title: string;
        description: string | null;
        close_condition: string | null;
        source_type: string | null;
        external_evidence_ref: string | null;
        confidence: number | null;
        human_confirmed: boolean;
        confirmed_by: string | null;
        confirmed_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }[]
    >`SELECT * FROM open_items WHERE project_id = ${projectId} ORDER BY created_at DESC`;
    const memberIds = rows.map((r) => r.confirmed_by).filter(Boolean) as string[];
    const members = await loadMembers(this.sql, memberIds);
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      workflowNodeId: r.workflow_node_id,
      itemType: r.item_type as OpenItemDto['itemType'],
      status: r.status as OpenItemDto['status'],
      responsibleParty: r.responsible_party as OpenItemDto['responsibleParty'],
      dueAt: r.due_at?.toISOString() ?? null,
      title: r.title,
      description: r.description,
      closeCondition: r.close_condition,
      sourceType: r.source_type,
      externalEvidenceRef: r.external_evidence_ref,
      confidence: r.confidence,
      humanConfirmed: r.human_confirmed,
      confirmedBy: r.confirmed_by ? (members.get(r.confirmed_by) ?? null) : null,
      confirmedAt: r.confirmed_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  async createOpenItem(projectId: string, body: CreateOpenItemBody): Promise<OpenItemDto> {
    const id = crypto.randomUUID();
    await this.sql`
      INSERT INTO open_items (
        id, project_id, workflow_node_id, item_type, responsible_party, due_at, title,
        description, close_condition, source_type, external_evidence_ref, confidence
      ) VALUES (
        ${id}, ${projectId}, ${body.workflowNodeId ?? null}, ${body.itemType},
        ${body.responsibleParty}, ${body.dueAt ?? null}, ${body.title},
        ${body.description ?? null}, ${body.closeCondition ?? null},
        ${body.sourceType ?? null}, ${body.externalEvidenceRef ?? null}, ${body.confidence ?? null}
      )
    `;
    await this.syncProjectDerivedState(this.sql, projectId);
    const items = await this.listOpenItems(projectId);
    return items.find((i) => i.id === id)!;
  }

  async patchOpenItem(
    projectId: string,
    itemId: string,
    body: PatchOpenItemBody,
  ): Promise<OpenItemDto | null> {
    const existingRows = await this.sql<
      {
        title: string;
        description: string | null;
        status: string;
        responsible_party: string;
        due_at: Date | null;
        close_condition: string | null;
        human_confirmed: boolean;
        confirmed_by: string | null;
      }[]
    >`SELECT title, description, status, responsible_party, due_at, close_condition, human_confirmed, confirmed_by
      FROM open_items WHERE id = ${itemId} AND project_id = ${projectId}`;
    const existing = existingRows[0];
    if (!existing) return null;
    const nextTitle = body.title ?? existing.title;
    const nextDescription =
      body.description !== undefined ? body.description : existing.description;
    const nextStatus = body.status ?? existing.status;
    const nextParty = body.responsibleParty ?? existing.responsible_party;
    const nextDue =
      body.dueAt !== undefined ? body.dueAt : (existing.due_at?.toISOString() ?? null);
    const nextClose =
      body.closeCondition !== undefined ? body.closeCondition : existing.close_condition;
    const nextConfirmed = body.humanConfirmed ?? existing.human_confirmed;
    const nextConfirmedBy = body.confirmedById ?? existing.confirmed_by;
    await this.sql`
      UPDATE open_items SET
        title = ${nextTitle},
        description = ${nextDescription},
        status = ${nextStatus},
        responsible_party = ${nextParty},
        due_at = ${nextDue},
        close_condition = ${nextClose},
        human_confirmed = ${nextConfirmed},
        confirmed_by = ${nextConfirmedBy},
        confirmed_at = ${body.humanConfirmed === true ? new Date() : null},
        updated_at = now()
      WHERE id = ${itemId} AND project_id = ${projectId}
    `;
    await this.syncProjectDerivedState(this.sql, projectId);
    const items = await this.listOpenItems(projectId);
    return items.find((i) => i.id === itemId) ?? null;
  }

  async getDownstreamNodes(projectId: string, nodeId: string): Promise<string[]> {
    const graph = await this.loadWorkflowGraph(projectId);
    if (!graph) return [];
    return downstreamNodeIds(nodeId, graph.deps);
  }

  async buildDashboard(referenceNow?: Date): Promise<DashboardTodayResponse> {
    const now = referenceNow ?? this.now();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
    const end7 = new Date(startOfDay);
    end7.setUTCDate(end7.getUTCDate() + 7);

    const projects = await this.sql<
      { id: string; name: string; planned_publish_at: Date | null; health_status: string }[]
    >`SELECT id, name, planned_publish_at, health_status FROM projects WHERE archived_at IS NULL`;

    const entries: DashboardTodayResponse['overdue'] = [];
    const rankMeta = new Map<
      string,
      { blockedDownstreamCount: number; publishWithinDays: number | null; isBlocked: boolean }
    >();
    for (const p of projects) {
      const publishWithinDays =
        p.planned_publish_at != null
          ? (p.planned_publish_at.getTime() - now.getTime()) / 86_400_000
          : null;
      const nodes = await this.sql<
        {
          id: string;
          label: string;
          status: string;
          due_at: Date | null;
          blocked_reason: string | null;
        }[]
      >`
        SELECT wn.id, wn.label, wn.status, wn.due_at, wn.blocked_reason FROM workflow_nodes wn
        JOIN project_workflows pw ON pw.id = wn.project_workflow_id
        WHERE pw.project_id = ${p.id} AND wn.due_at IS NOT NULL
      `;
      const graph = await this.loadWorkflowGraph(p.id);
      for (const n of nodes) {
        if (!n.due_at) continue;
        const due = n.due_at;
        const isOverdue = due < now;
        const dueToday = due >= startOfDay && due < endOfDay;
        const due7 = due >= endOfDay && due < end7;
        if (!isOverdue && !dueToday && !due7) continue;
        const downstream = graph ? downstreamNodeIds(n.id, graph.deps).length : 0;
        const entryId = `node-${n.id}`;
        rankMeta.set(entryId, {
          blockedDownstreamCount: downstream,
          publishWithinDays,
          isBlocked: n.status === 'blocked',
        });
        entries.push({
          id: entryId,
          kind: 'node',
          projectId: p.id,
          projectName: p.name,
          title: n.label,
          issue: n.blocked_reason ?? n.status,
          responsibleParty: n.status === 'waiting_external' ? 'client' : 'us',
          dueAt: due.toISOString(),
          suggestedNextStep: n.blocked_reason ? '跟进阻塞原因' : '推进节点状态',
          rank: 0,
          sortReasons: [],
          explanation: '',
          focusNodeId: n.id,
          focusOpenItemId: null,
        });
      }
      const items = await this.listOpenItems(p.id);
      for (const item of items.filter((i) => i.status === 'open')) {
        const due = item.dueAt ? new Date(item.dueAt) : null;
        const isOverdue = due != null && due < now;
        const dueToday = due != null && due >= startOfDay && due < endOfDay;
        const due7 = due != null && due >= endOfDay && due < end7;
        if (!isOverdue && !dueToday && !due7 && item.itemType !== 'confirmation') continue;
        const entryId = `item-${item.id}`;
        rankMeta.set(entryId, {
          blockedDownstreamCount: 0,
          publishWithinDays,
          isBlocked: false,
        });
        entries.push({
          id: entryId,
          kind: 'open_item',
          projectId: p.id,
          projectName: p.name,
          title: item.title,
          issue: item.itemType,
          responsibleParty: item.responsibleParty,
          dueAt: item.dueAt,
          suggestedNextStep: item.closeCondition ?? '处理未闭环事项',
          rank: 0,
          sortReasons: [],
          explanation: '',
          focusNodeId: item.workflowNodeId,
          focusOpenItemId: item.id,
        });
      }
      if (p.health_status === 'blocked') {
        const entryId = `project-${p.id}`;
        rankMeta.set(entryId, {
          blockedDownstreamCount: 0,
          publishWithinDays,
          isBlocked: true,
        });
        entries.push({
          id: entryId,
          kind: 'project',
          projectId: p.id,
          projectName: p.name,
          title: '项目阻塞',
          issue: '存在阻塞节点或外部等待',
          responsibleParty: 'us',
          dueAt: p.planned_publish_at?.toISOString() ?? null,
          suggestedNextStep: '查看工作流树',
          rank: 0,
          sortReasons: [],
          explanation: '',
          focusNodeId: null,
          focusOpenItemId: null,
        });
      }
    }

    const { rankDashboardItems } = await import('@studio/workflow');
    const ranked = rankDashboardItems(
      entries.map((e) => ({
        id: e.id,
        kind:
          e.kind === 'node' ? 'node_due' : e.kind === 'open_item' ? 'open_item' : 'blocked_project',
        projectId: e.projectId,
        dueAt: e.dueAt,
        isOverdue: e.dueAt ? new Date(e.dueAt) < now : false,
        isBlocked: rankMeta.get(e.id)?.isBlocked ?? e.kind === 'project',
        blockedDownstreamCount: rankMeta.get(e.id)?.blockedDownstreamCount ?? 0,
        waitingParty:
          e.responsibleParty === 'us'
            ? 'us'
            : e.responsibleParty === 'client'
              ? 'client'
              : e.issue === 'confirmation'
                ? 'confirmation'
                : null,
        waitingExternalHours: 0,
        publishWithinDays: rankMeta.get(e.id)?.publishWithinDays ?? null,
      })),
    );
    const byId = new Map(ranked.map((r) => [r.id, r]));
    const enrich = (list: typeof entries) =>
      list.map((e) => {
        const r = byId.get(e.id);
        return {
          ...e,
          rank: r?.rank ?? 999,
          sortReasons: r?.sortReasons ?? [],
          explanation: r?.explanation ?? '',
        };
      });

    const overdue = enrich(entries.filter((e) => e.dueAt && new Date(e.dueAt) < now));
    const dueToday = enrich(
      entries.filter(
        (e) => e.dueAt && new Date(e.dueAt) >= startOfDay && new Date(e.dueAt) < endOfDay,
      ),
    );
    const dueNext7Days = enrich(
      entries.filter((e) => e.dueAt && new Date(e.dueAt) >= endOfDay && new Date(e.dueAt) < end7),
    );
    const blockedProjects = enrich(entries.filter((e) => e.kind === 'project'));
    const waitingClient = enrich(entries.filter((e) => e.responsibleParty === 'client'));
    const waitingUs = enrich(
      entries.filter((e) => e.responsibleParty === 'us' && e.kind === 'open_item'),
    );
    const pendingConfirmation = enrich(entries.filter((e) => e.issue === 'confirmation'));

    return {
      generatedAt: now.toISOString(),
      overdue,
      dueToday,
      dueNext7Days,
      blockedProjects,
      waitingClient,
      waitingUs,
      pendingConfirmation,
    };
  }

  async createHermesProposal(input: {
    projectId: string;
    idempotencyKey: string;
    suggestedAction: string;
    payload: Record<string, unknown>;
    sourceEvidence?: Record<string, unknown>;
    confidence: number;
  }): Promise<HermesChangeProposal> {
    const existing = await this.sql<
      {
        id: string;
        project_id: string;
        idempotency_key: string;
        status: string;
        suggested_action: string;
        payload: Record<string, unknown>;
        source_evidence: Record<string, unknown> | null;
        confidence: number;
        rejection_reason: string | null;
        created_at: Date;
        resolved_at: Date | null;
      }[]
    >`SELECT * FROM hermes_change_proposals WHERE idempotency_key = ${input.idempotencyKey}`;
    if (existing[0]) return this.mapProposal(existing[0]);

    const id = crypto.randomUUID();
    await this.sql`
      INSERT INTO hermes_change_proposals (
        id, project_id, idempotency_key, suggested_action, payload, source_evidence, confidence
      ) VALUES (
        ${id}, ${input.projectId}, ${input.idempotencyKey}, ${input.suggestedAction},
        ${JSON.stringify(input.payload)}, ${input.sourceEvidence ? JSON.stringify(input.sourceEvidence) : null},
        ${input.confidence}
      )
    `;
    const rows = await this.sql<
      {
        id: string;
        project_id: string;
        idempotency_key: string;
        status: string;
        suggested_action: string;
        payload: Record<string, unknown>;
        source_evidence: Record<string, unknown> | null;
        confidence: number;
        rejection_reason: string | null;
        created_at: Date;
        resolved_at: Date | null;
      }[]
    >`SELECT * FROM hermes_change_proposals WHERE id = ${id}`;
    return this.mapProposal(rows[0]!);
  }

  private mapProposal(row: {
    id: string;
    project_id: string;
    idempotency_key: string;
    status: string;
    suggested_action: string;
    payload: Record<string, unknown>;
    source_evidence: Record<string, unknown> | null;
    confidence: number;
    rejection_reason: string | null;
    created_at: Date;
    resolved_at: Date | null;
  }): HermesChangeProposal {
    return {
      id: row.id,
      projectId: row.project_id,
      idempotencyKey: row.idempotency_key,
      status: row.status as HermesChangeProposal['status'],
      suggestedAction: row.suggested_action,
      payload: row.payload,
      sourceEvidence: row.source_evidence,
      confidence: row.confidence,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString() ?? null,
    };
  }

  async acceptHermesProposal(proposalId: string): Promise<HermesChangeProposal | null> {
    const rows = await this.sql<
      {
        id: string;
        project_id: string;
        status: string;
        payload: Record<string, unknown>;
        idempotency_key: string;
        suggested_action: string;
        source_evidence: Record<string, unknown> | null;
        confidence: number;
        rejection_reason: string | null;
        created_at: Date;
        resolved_at: Date | null;
      }[]
    >`SELECT * FROM hermes_change_proposals WHERE id = ${proposalId}`;
    const row = rows[0];
    if (!row) return null;
    if (row.status !== 'pending') return this.mapProposal(row);

    const action = row.payload.action;
    if (action === 'patch_node' && typeof row.payload.nodeId === 'string') {
      await this.patchWorkflowNode(row.project_id, row.payload.nodeId, {
        status: row.payload.status as PatchWorkflowNodeBody['status'],
        blockedReason: (row.payload.blockedReason as string | null) ?? undefined,
      });
    } else if (action === 'patch_project') {
      await this.patchProject(row.project_id, row.payload as PatchProjectBody);
    } else if (action === 'create_open_item') {
      await this.createOpenItem(row.project_id, row.payload as CreateOpenItemBody);
    }
    await this.sql`
      UPDATE hermes_change_proposals SET status = 'accepted', resolved_at = now()
      WHERE id = ${proposalId} AND status = 'pending'
    `;

    const updated = await this.sql<
      {
        id: string;
        project_id: string;
        idempotency_key: string;
        status: string;
        suggested_action: string;
        payload: Record<string, unknown>;
        source_evidence: Record<string, unknown> | null;
        confidence: number;
        rejection_reason: string | null;
        created_at: Date;
        resolved_at: Date | null;
      }[]
    >`SELECT * FROM hermes_change_proposals WHERE id = ${proposalId}`;
    return updated[0] ? this.mapProposal(updated[0]) : null;
  }

  async rejectHermesProposal(
    proposalId: string,
    reason: string,
  ): Promise<HermesChangeProposal | null> {
    await this.sql`
      UPDATE hermes_change_proposals SET status = 'rejected', rejection_reason = ${reason}, resolved_at = now()
      WHERE id = ${proposalId} AND status = 'pending'
    `;
    const rows = await this.sql<
      {
        id: string;
        project_id: string;
        idempotency_key: string;
        status: string;
        suggested_action: string;
        payload: Record<string, unknown>;
        source_evidence: Record<string, unknown> | null;
        confidence: number;
        rejection_reason: string | null;
        created_at: Date;
        resolved_at: Date | null;
      }[]
    >`SELECT * FROM hermes_change_proposals WHERE id = ${proposalId}`;
    return rows[0] ? this.mapProposal(rows[0]) : null;
  }
}
