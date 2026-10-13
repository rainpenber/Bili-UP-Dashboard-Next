import type {
  CreateOpenItemBody,
  DashboardTodayResponse,
  HermesChangeProposal,
  HermesPayload,
  OpenItemDto,
  PatchOpenItemBody,
  PatchProjectBody,
  PatchWorkflowNodeBody,
  ProjectSummary,
  ProjectWorkflowResponse,
  TeamMember,
  WorkflowNodeDto,
} from '@studio/contracts';
import {
  dashboardTodayResponseSchema,
  hermesChangeProposalSchema,
  parseHermesPayload,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import {
  buildDashboardBuckets,
  downstreamNodeIds,
  recomputeAfterManualChange,
  type WorkflowDependency,
  type WorkflowNodeSnapshot,
} from '@studio/workflow';
import {
  applyHermesPayloadTx,
  applyProjectPatchTx,
  createOpenItemTx,
  instantiateStandardWorkflowTx,
  patchOpenItemTx,
  patchWorkflowNodeTx,
  type DbExecutor,
} from './project-store';

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
      await instantiateStandardWorkflowTx(tx as unknown as DbExecutor, id);
    });
    const created = await this.getProject(id);
    if (!created) throw new Error('create failed');
    return created;
  }

  async patchProject(id: string, body: PatchProjectBody): Promise<ProjectSummary | null> {
    const existing = await this.getProject(id);
    if (!existing) return null;
    await this.sql.begin(async (tx) => {
      await applyProjectPatchTx(tx as unknown as DbExecutor, id, body);
    });
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
    const exists = await this.sql<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM workflow_nodes wn
        JOIN project_workflows pw ON pw.id = wn.project_workflow_id
        WHERE wn.id = ${nodeId} AND pw.project_id = ${projectId}
      ) AS ok
    `;
    if (!exists[0]?.ok) return null;

    await this.sql.begin(async (tx) => {
      await patchWorkflowNodeTx(tx as unknown as DbExecutor, projectId, nodeId, body);
    });

    return this.getWorkflow(projectId);
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
    const id = await this.sql.begin(async (tx) =>
      createOpenItemTx(tx as unknown as DbExecutor, projectId, body),
    );
    const items = await this.listOpenItems(projectId);
    return items.find((i) => i.id === id)!;
  }

  async patchOpenItem(
    projectId: string,
    itemId: string,
    body: PatchOpenItemBody,
  ): Promise<OpenItemDto | null> {
    try {
      await this.sql.begin(async (tx) => {
        await patchOpenItemTx(tx as unknown as DbExecutor, projectId, itemId, body);
      });
    } catch (err) {
      if ((err as Error & { status?: number }).status === 404) return null;
      throw err;
    }
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
    const projects = await this.sql<
      { id: string; name: string; planned_publish_at: Date | null; health_status: string }[]
    >`SELECT id, name, planned_publish_at, health_status FROM projects WHERE archived_at IS NULL`;

    const drafts = [];
    for (const p of projects) {
      const publishWithinDays =
        p.planned_publish_at != null
          ? (p.planned_publish_at.getTime() - now.getTime()) / 86_400_000
          : null;
      const graph = await this.loadWorkflowGraph(p.id);
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
        WHERE pw.project_id = ${p.id}
      `;
      for (const n of nodes) {
        const downstream = graph ? downstreamNodeIds(n.id, graph.deps).length : 0;
        drafts.push({
          id: `node-${n.id}`,
          kind: 'node' as const,
          projectId: p.id,
          projectName: p.name,
          title: n.label,
          issue: n.blocked_reason ?? n.status,
          responsibleParty: n.status === 'waiting_external' ? 'client' : 'us',
          dueAt: n.due_at?.toISOString() ?? null,
          suggestedNextStep: n.blocked_reason ? '跟进阻塞原因' : '推进节点状态',
          focusNodeId: n.id,
          focusOpenItemId: null,
          nodeStatus: n.status,
          blockedDownstreamCount: downstream,
          publishWithinDays,
          isBlocked: n.status === 'blocked',
        });
      }
      for (const item of await this.listOpenItems(p.id)) {
        if (item.status !== 'open') continue;
        drafts.push({
          id: `item-${item.id}`,
          kind: 'open_item' as const,
          projectId: p.id,
          projectName: p.name,
          title: item.title,
          issue: item.itemType,
          responsibleParty: item.responsibleParty,
          dueAt: item.dueAt,
          suggestedNextStep: item.closeCondition ?? '处理未闭环事项',
          focusNodeId: item.workflowNodeId,
          focusOpenItemId: item.id,
          itemType: item.itemType,
          openItemStatus: item.status,
          humanConfirmed: item.humanConfirmed,
          publishWithinDays,
        });
      }
      if (p.health_status === 'blocked') {
        drafts.push({
          id: `project-${p.id}`,
          kind: 'project' as const,
          projectId: p.id,
          projectName: p.name,
          title: '项目阻塞',
          issue: '存在阻塞节点或外部等待',
          responsibleParty: 'us',
          dueAt: p.planned_publish_at?.toISOString() ?? null,
          suggestedNextStep: '查看工作流树',
          focusNodeId: null,
          focusOpenItemId: null,
          publishWithinDays,
          isBlocked: true,
        });
      }
    }

    const buckets = buildDashboardBuckets(drafts, now);
    const mapEntry = (e: (typeof buckets.overdue)[number]) => ({
      id: e.id,
      kind: e.kind,
      projectId: e.projectId,
      projectName: e.projectName,
      title: e.title,
      issue: e.issue,
      responsibleParty: e.responsibleParty,
      dueAt: e.dueAt,
      suggestedNextStep: e.suggestedNextStep,
      rank: e.rank,
      sortReasons: e.sortReasons,
      explanation: e.explanation,
      focusNodeId: e.focusNodeId,
      focusOpenItemId: e.focusOpenItemId,
    });
    const body = {
      generatedAt: now.toISOString(),
      overdue: buckets.overdue.map(mapEntry),
      dueToday: buckets.dueToday.map(mapEntry),
      dueNext7Days: buckets.dueNext7Days.map(mapEntry),
      blockedProjects: buckets.blockedProjects.map(mapEntry),
      waitingClient: buckets.waitingClient.map(mapEntry),
      waitingUs: buckets.waitingUs.map(mapEntry),
      pendingConfirmation: buckets.pendingConfirmation.map(mapEntry),
    };
    return dashboardTodayResponseSchema.parse(body) as DashboardTodayResponse;
  }

  async createHermesProposal(input: {
    projectId: string;
    idempotencyKey: string;
    suggestedAction: string;
    payload: HermesPayload;
    sourceEvidence?: Record<string, unknown>;
    confidence: number;
  }): Promise<HermesChangeProposal> {
    const id = crypto.randomUUID();
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
    >`
      INSERT INTO hermes_change_proposals (
        id, project_id, idempotency_key, suggested_action, payload, source_evidence, confidence
      ) VALUES (
        ${id}, ${input.projectId}, ${input.idempotencyKey}, ${input.suggestedAction},
        ${JSON.stringify(input.payload)}::jsonb,
        ${input.sourceEvidence ? JSON.stringify(input.sourceEvidence) : null}::jsonb,
        ${input.confidence}
      )
      ON CONFLICT (idempotency_key) DO UPDATE
        SET idempotency_key = hermes_change_proposals.idempotency_key
      RETURNING *
    `;
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
    const rawPayload =
      typeof row.payload === 'string' ? (JSON.parse(row.payload) as unknown) : row.payload;
    const proposal = {
      id: row.id,
      projectId: row.project_id,
      idempotencyKey: row.idempotency_key,
      status: row.status as HermesChangeProposal['status'],
      suggestedAction: row.suggested_action,
      payload: rawPayload,
      sourceEvidence: row.source_evidence,
      confidence: row.confidence,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString() ?? null,
    };
    return hermesChangeProposalSchema.parse(proposal) as HermesChangeProposal;
  }

  async acceptHermesProposal(proposalId: string): Promise<HermesChangeProposal | null> {
    type ProposalRow = {
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
    };

    return this.sql.begin(async (tx) => {
      const locked = await tx<ProposalRow[]>`
        SELECT * FROM hermes_change_proposals WHERE id = ${proposalId} FOR UPDATE
      `;
      const row = locked[0];
      if (!row) return null;
      if (row.status !== 'pending') return this.mapProposal(row);

      let payload: HermesPayload;
      try {
        const rawPayload =
          typeof row.payload === 'string' ? (JSON.parse(row.payload) as unknown) : row.payload;
        payload = parseHermesPayload(rawPayload);
      } catch {
        const err = new Error('invalid proposal payload');
        (err as Error & { status: number }).status = 400;
        throw err;
      }
      if (row.suggested_action !== payload.action) {
        const err = new Error('suggestedAction does not match payload.action');
        (err as Error & { status: number }).status = 400;
        throw err;
      }

      await applyHermesPayloadTx(tx as unknown as DbExecutor, row.project_id, payload);
      const updated = await tx<ProposalRow[]>`
        UPDATE hermes_change_proposals SET status = 'accepted', resolved_at = now()
        WHERE id = ${proposalId} AND status = 'pending'
        RETURNING *
      `;
      return updated[0] ? this.mapProposal(updated[0]) : this.mapProposal(row);
    });
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
