import { z } from 'zod';

export const nodeStatusSchema = z.enum([
  'locked',
  'ready',
  'in_progress',
  'waiting_external',
  'blocked',
  'completed',
  'skipped',
]);

export const projectStageSchema = z.enum([
  'business_init',
  'outline',
  'copywriting',
  'production',
  'review',
  'publish',
  'go_live_monitoring',
  'settlement',
  'completed',
]);

export const sourceStatusSchema = z.enum([
  'confirmed',
  'auto_confirmed',
  'pending_confirmation',
  'conflict',
  'unknown',
]);

export const healthStatusSchema = z.enum(['healthy', 'at_risk', 'blocked']);

export const openItemTypeSchema = z.enum([
  'our_action',
  'client_reply',
  'confirmation',
  'delivery',
  'revision',
  'logistics',
  'finance',
  'risk_conflict',
]);

export const openItemStatusSchema = z.enum(['open', 'resolved', 'cancelled']);

export const responsiblePartySchema = z.enum(['us', 'client', 'both', 'unknown']);

export type TeamMember = {
  id: string;
  displayName: string;
  roleLabels: string[];
};

export type ProjectSummary = {
  id: string;
  name: string;
  brand: string | null;
  product: string | null;
  cooperationType: string | null;
  derivedStage: z.infer<typeof projectStageSchema>;
  plannedPublishAt: string | null;
  owner: TeamMember | null;
  healthStatus: z.infer<typeof healthStatusSchema>;
  sourceStatus: z.infer<typeof sourceStatusSchema>;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  openItemCount: number;
  primaryBlockReason: string | null;
  nextStepLabel: string | null;
};

export type WorkflowNodeDto = {
  id: string;
  slug: string;
  label: string;
  parentId: string | null;
  sortOrder: number;
  isRequired: boolean;
  dependencyMode: 'all_of' | 'any_of';
  status: z.infer<typeof nodeStatusSchema>;
  owner: TeamMember | null;
  dueAt: string | null;
  completionCriteria: string | null;
  blockedReason: string | null;
  stageKey: string | null;
  blockedByNodeIds: string[];
  dependencyNodeIds: string[];
  statusChangedAt: string;
  completedAt: string | null;
};

export type WorkflowStatusHistoryEntry = {
  id: string;
  nodeId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
  note: string | null;
};

export type ProjectWorkflowResponse = {
  projectId: string;
  workflowId: string;
  templateSlug: string;
  nodes: WorkflowNodeDto[];
  recentHistory: WorkflowStatusHistoryEntry[];
};

export type OpenItemDto = {
  id: string;
  projectId: string;
  workflowNodeId: string | null;
  itemType: z.infer<typeof openItemTypeSchema>;
  status: z.infer<typeof openItemStatusSchema>;
  responsibleParty: z.infer<typeof responsiblePartySchema>;
  dueAt: string | null;
  title: string;
  description: string | null;
  closeCondition: string | null;
  sourceType: string | null;
  externalEvidenceRef: string | null;
  confidence: number | null;
  humanConfirmed: boolean;
  confirmedBy: TeamMember | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DashboardTodayResponse = {
  generatedAt: string;
  overdue: DashboardEntry[];
  dueToday: DashboardEntry[];
  dueNext7Days: DashboardEntry[];
  blockedProjects: DashboardEntry[];
  waitingClient: DashboardEntry[];
  waitingUs: DashboardEntry[];
  pendingConfirmation: DashboardEntry[];
};

export type DashboardEntry = {
  id: string;
  kind: 'node' | 'open_item' | 'project';
  projectId: string;
  projectName: string;
  title: string;
  issue: string;
  responsibleParty: string;
  dueAt: string | null;
  suggestedNextStep: string;
  rank: number;
  sortReasons: string[];
  explanation: string;
  focusNodeId: string | null;
  focusOpenItemId: string | null;
};

export type HermesProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';

export type HermesChangeProposal = {
  id: string;
  projectId: string;
  idempotencyKey: string;
  status: HermesProposalStatus;
  suggestedAction: 'patch_project' | 'patch_node' | 'create_open_item';
  payload: HermesPayload;
  sourceEvidence: Record<string, unknown> | null;
  confidence: number;
  rejectionReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export const teamMemberSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  roleLabels: z.array(z.string()),
});

export const projectSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  brand: z.string().nullable(),
  product: z.string().nullable(),
  cooperationType: z.string().nullable(),
  derivedStage: projectStageSchema,
  plannedPublishAt: z.string().datetime().nullable(),
  owner: teamMemberSchema.nullable(),
  healthStatus: healthStatusSchema,
  sourceStatus: sourceStatusSchema,
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  openItemCount: z.number().int().nonnegative(),
  primaryBlockReason: z.string().nullable(),
  nextStepLabel: z.string().nullable(),
});

export const workflowNodeSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  label: z.string(),
  parentId: z.string().uuid().nullable(),
  sortOrder: z.number().int(),
  isRequired: z.boolean(),
  dependencyMode: z.enum(['all_of', 'any_of']),
  status: nodeStatusSchema,
  owner: teamMemberSchema.nullable(),
  dueAt: z.string().datetime().nullable(),
  completionCriteria: z.string().nullable(),
  blockedReason: z.string().nullable(),
  stageKey: z.string().nullable(),
  blockedByNodeIds: z.array(z.string().uuid()),
  dependencyNodeIds: z.array(z.string().uuid()),
  statusChangedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const projectWorkflowResponseSchema = z.object({
  projectId: z.string().uuid(),
  workflowId: z.string().uuid(),
  templateSlug: z.string(),
  nodes: z.array(workflowNodeSchema),
  recentHistory: z.array(
    z.object({
      id: z.string(),
      nodeId: z.string().uuid(),
      fromStatus: z.string().nullable(),
      toStatus: z.string(),
      changedAt: z.string().datetime(),
      note: z.string().nullable(),
    }),
  ),
});

export const openItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  workflowNodeId: z.string().uuid().nullable(),
  itemType: openItemTypeSchema,
  status: openItemStatusSchema,
  responsibleParty: responsiblePartySchema,
  dueAt: z.string().datetime().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  closeCondition: z.string().nullable(),
  sourceType: z.string().nullable(),
  externalEvidenceRef: z.string().nullable(),
  confidence: z.number().nullable(),
  humanConfirmed: z.boolean(),
  confirmedBy: teamMemberSchema.nullable(),
  confirmedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const dashboardEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['node', 'open_item', 'project']),
  projectId: z.string().uuid(),
  projectName: z.string(),
  title: z.string(),
  issue: z.string(),
  responsibleParty: z.string(),
  dueAt: z.string().datetime().nullable(),
  suggestedNextStep: z.string(),
  rank: z.number(),
  sortReasons: z.array(z.string()),
  explanation: z.string(),
  focusNodeId: z.string().uuid().nullable(),
  focusOpenItemId: z.string().uuid().nullable(),
});

export const dashboardTodayResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  overdue: z.array(dashboardEntrySchema),
  dueToday: z.array(dashboardEntrySchema),
  dueNext7Days: z.array(dashboardEntrySchema),
  blockedProjects: z.array(dashboardEntrySchema),
  waitingClient: z.array(dashboardEntrySchema),
  waitingUs: z.array(dashboardEntrySchema),
  pendingConfirmation: z.array(dashboardEntrySchema),
});

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
});

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return paginationMetaSchema.extend({ items: z.array(item) });
}

export const teamMembersResponseSchema = z.object({
  items: z.array(teamMemberSchema),
});

export const openItemsListResponseSchema = z.object({
  items: z.array(openItemSchema),
});

export const projectPaginatedResponseSchema = paginatedSchema(projectSummarySchema);

export const createProjectBodySchema = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().max(200).optional(),
  product: z.string().max(200).optional(),
  cooperationType: z.string().max(100).optional(),
  plannedPublishAt: z.string().datetime().optional(),
  ownerId: z.string().uuid().optional(),
  sourceStatus: sourceStatusSchema.optional(),
});

export const patchProjectBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  brand: z.string().max(200).nullable().optional(),
  product: z.string().max(200).nullable().optional(),
  cooperationType: z.string().max(100).nullable().optional(),
  plannedPublishAt: z.string().datetime().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  sourceStatus: sourceStatusSchema.optional(),
});

export const projectListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  stage: projectStageSchema.optional(),
  ownerId: z.string().uuid().optional(),
  risk: z.enum(['blocked', 'at_risk', 'any']).optional(),
  dueBefore: z.string().datetime().optional(),
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

export const patchWorkflowNodeBodySchema = z.object({
  status: nodeStatusSchema.optional(),
  ownerId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  blockedReason: z.string().max(2000).nullable().optional(),
});

export const createOpenItemFieldsSchema = z.object({
  itemType: openItemTypeSchema,
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  responsibleParty: responsiblePartySchema,
  dueAt: z.string().datetime().optional(),
  closeCondition: z.string().max(1000).optional(),
  workflowNodeId: z.string().uuid().optional(),
  sourceType: z.string().max(100).optional(),
  externalEvidenceRef: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).optional(),
  humanConfirmed: z.boolean().optional(),
  confirmedById: z.string().uuid().optional(),
});

export function validateOpenItemConfirmationPair(
  humanConfirmed: boolean | undefined,
  confirmedById: string | undefined,
): string | null {
  if (confirmedById !== undefined && humanConfirmed === undefined) {
    return 'confirmedById requires humanConfirmed';
  }
  if (humanConfirmed === false && confirmedById !== undefined) {
    return 'humanConfirmed false must not include confirmedById';
  }
  if (humanConfirmed === true && !confirmedById) {
    return 'humanConfirmed true requires confirmedById';
  }
  return null;
}

export const createOpenItemBodySchema = createOpenItemFieldsSchema.superRefine((val, ctx) => {
  const message = validateOpenItemConfirmationPair(val.humanConfirmed, val.confirmedById);
  if (message) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path: ['confirmedById'],
    });
  }
});

export const patchOpenItemBodySchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: openItemStatusSchema.optional(),
    itemType: openItemTypeSchema.optional(),
    responsibleParty: responsiblePartySchema.optional(),
    dueAt: z.string().datetime().nullable().optional(),
    closeCondition: z.string().max(1000).nullable().optional(),
    workflowNodeId: z.string().uuid().nullable().optional(),
    humanConfirmed: z.boolean().optional(),
    confirmedById: z.string().uuid().optional(),
  })
  .superRefine((val, ctx) => {
    const message = validateOpenItemConfirmationPair(val.humanConfirmed, val.confirmedById);
    if (message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message,
        path: ['confirmedById'],
      });
    }
  });

export const hermesSuggestedActionSchema = z.enum([
  'patch_project',
  'patch_node',
  'create_open_item',
]);

const hermesPatchNodePayloadSchema = patchWorkflowNodeBodySchema.extend({
  action: z.literal('patch_node'),
  nodeId: z.string().uuid(),
});

export const hermesPayloadSchema = z.discriminatedUnion('action', [
  patchProjectBodySchema.extend({ action: z.literal('patch_project') }),
  hermesPatchNodePayloadSchema,
  createOpenItemFieldsSchema.extend({ action: z.literal('create_open_item') }),
]);

export const hermesProposalBodySchema = z
  .object({
    projectId: z.string().uuid(),
    idempotencyKey: z.string().min(1).max(200),
    suggestedAction: hermesSuggestedActionSchema,
    payload: hermesPayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
  })
  .superRefine((val, ctx) => {
    if (val.suggestedAction !== val.payload.action) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'suggestedAction must match payload.action',
        path: ['suggestedAction'],
      });
    }
    if (val.payload.action === 'create_open_item') {
      const message = validateOpenItemConfirmationPair(
        val.payload.humanConfirmed,
        val.payload.confirmedById,
      );
      if (message) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message,
          path: ['payload', 'confirmedById'],
        });
      }
    }
  });

export const hermesChangeProposalSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  idempotencyKey: z.string(),
  status: z.enum(['pending', 'accepted', 'rejected', 'superseded']),
  suggestedAction: hermesSuggestedActionSchema,
  payload: hermesPayloadSchema,
  sourceEvidence: z.record(z.unknown()).nullable(),
  confidence: z.number(),
  rejectionReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});

export const hermesRejectBodySchema = z.object({
  reason: z.string().min(1).max(2000),
});

export type ApiErrorBody = {
  error: string;
  requestId?: string;
  details?: unknown;
};

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;
export type PatchProjectBody = z.infer<typeof patchProjectBodySchema>;
export type PatchWorkflowNodeBody = z.infer<typeof patchWorkflowNodeBodySchema>;
export type CreateOpenItemBody = z.infer<typeof createOpenItemBodySchema>;
export type PatchOpenItemBody = z.infer<typeof patchOpenItemBodySchema>;
export type HermesProposalBody = z.infer<typeof hermesProposalBodySchema>;
export type HermesPayload = z.infer<typeof hermesPayloadSchema>;

export function parseHermesPayload(input: unknown): HermesPayload {
  const parsed = hermesPayloadSchema.parse(input);
  if (
    parsed.action === 'patch_node' &&
    parsed.status == null &&
    parsed.ownerId === undefined &&
    parsed.dueAt === undefined &&
    parsed.blockedReason === undefined
  ) {
    throw new Error('patch_node requires at least one field to change');
  }
  if (parsed.action === 'create_open_item') {
    const message = validateOpenItemConfirmationPair(parsed.humanConfirmed, parsed.confirmedById);
    if (message) throw new Error(message);
  }
  return parsed;
}

export function parseProjectSummary(output: unknown): ProjectSummary {
  return projectSummarySchema.parse(output) as ProjectSummary;
}

export function parseDashboardToday(output: unknown): DashboardTodayResponse {
  return dashboardTodayResponseSchema.parse(output) as DashboardTodayResponse;
}

export function parseProjectWorkflow(output: unknown): ProjectWorkflowResponse {
  return projectWorkflowResponseSchema.parse(output) as ProjectWorkflowResponse;
}

export function parseOpenItemsList(output: unknown): { items: OpenItemDto[] } {
  return openItemsListResponseSchema.parse(output) as { items: OpenItemDto[] };
}

export function parseTeamMembersResponse(output: unknown): { items: TeamMember[] } {
  return teamMembersResponseSchema.parse(output) as { items: TeamMember[] };
}

export function parseHermesChangeProposal(output: unknown): HermesChangeProposal {
  return hermesChangeProposalSchema.parse(output) as HermesChangeProposal;
}

export function parseProjectPaginated(output: unknown) {
  return projectPaginatedResponseSchema.parse(output);
}

export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  }
  return parsed.data;
}
