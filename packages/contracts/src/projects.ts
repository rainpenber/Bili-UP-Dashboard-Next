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
  suggestedAction: string;
  payload: Record<string, unknown>;
  sourceEvidence: Record<string, unknown> | null;
  confidence: number;
  rejectionReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export const createProjectBodySchema = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().max(200).optional(),
  product: z.string().max(200).optional(),
  cooperationType: z.string().max(100).optional(),
  plannedPublishAt: z.string().datetime().optional(),
  ownerId: z.string().uuid().optional(),
  sourceStatus: sourceStatusSchema.optional(),
});

export const patchProjectBodySchema = createProjectBodySchema.partial();

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

export const createOpenItemBodySchema = z.object({
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
});

export const patchOpenItemBodySchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: openItemStatusSchema.optional(),
  responsibleParty: responsiblePartySchema.optional(),
  dueAt: z.string().datetime().nullable().optional(),
  closeCondition: z.string().max(1000).nullable().optional(),
  humanConfirmed: z.boolean().optional(),
  confirmedById: z.string().uuid().optional(),
});

export const hermesProposalBodySchema = z.object({
  projectId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(200),
  suggestedAction: z.string().min(1).max(200),
  payload: z.record(z.unknown()),
  sourceEvidence: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).default(0),
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

export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  }
  return parsed.data;
}
