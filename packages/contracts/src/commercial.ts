import { z } from 'zod';

export const nodeStatusSchema = z.enum([
  'not_reached',
  'in_progress',
  'completed',
  'blocked',
  'not_applicable',
]);

export const overallStageSchema = z.enum([
  'pre_publish',
  'published_winding_down',
  'closed',
  'archived',
]);

export const openItemLifecycleSchema = z.enum(['open', 'closed', 'cancelled']);
export const openItemImpactSchema = z.enum(['normal', 'blocking']);
export const nextActorSchema = z.enum(['us', 'client']);

export const projectSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  netAmount: z.number().nullable(),
  rebateAmount: z.number().nullable(),
  overallStage: overallStageSchema,
  userDeadlineAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
  businessClosedAt: z.string().datetime().nullable(),
  primaryBlockLabel: z.string().nullable(),
  openItemCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const wfNodeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: nodeStatusSchema,
  isOptional: z.boolean(),
  plannedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  posX: z.number(),
  posY: z.number(),
  packageId: z.string().uuid().nullable(),
  blockingOpenItemId: z.string().uuid().nullable(),
  slug: z.string().nullable(),
});

export const wfEdgeSchema = z.object({
  id: z.string().uuid(),
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
});

export const workflowGraphSchema = z.object({
  projectId: z.string().uuid(),
  workflowId: z.string().uuid(),
  nodes: z.array(wfNodeSchema),
  edges: z.array(wfEdgeSchema),
});

export const openItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  workflowNodeId: z.string().uuid().nullable(),
  blocksNodeId: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  closeCriteria: z.string().nullable(),
  nextAction: z.string().nullable(),
  nextActor: nextActorSchema,
  lifecycle: openItemLifecycleSchema,
  impact: openItemImpactSchema,
  plannedAt: z.string().datetime().nullable(),
  sourceEvidence: z.record(z.unknown()).nullable(),
  confidence: z.number().nullable(),
  closeConclusion: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
});

export const homeDashboardSchema = z.object({
  generatedAt: z.string().datetime(),
  ourOpenItems: z.array(
    z.object({
      projectId: z.string().uuid(),
      projectName: z.string(),
      itemId: z.string().uuid(),
      title: z.string(),
      nextAction: z.string().nullable(),
      plannedAt: z.string().datetime().nullable(),
    }),
  ),
  clientOpenItems: z.array(
    z.object({
      projectId: z.string().uuid(),
      projectName: z.string(),
      itemId: z.string().uuid(),
      title: z.string(),
      nextAction: z.string().nullable(),
      plannedAt: z.string().datetime().nullable(),
    }),
  ),
  blockedProjects: z.array(
    z.object({
      projectId: z.string().uuid(),
      projectName: z.string(),
      blockedNodeId: z.string().uuid(),
      blockedNodeName: z.string(),
      primaryBlock: z.string().nullable(),
      userDeadlineAt: z.string().datetime().nullable(),
      blockedSinceHours: z.number().nullable(),
    }),
  ),
});

export const publishRecordSchema = z.object({
  projectId: z.string().uuid(),
  bvid: z.string(),
  publishedAt: z.string().datetime(),
  internalStageAt: z.string().datetime(),
  publishSource: z.enum(['web', 'hermes', 'manual']),
});

export const createProjectBodySchema = z.object({
  name: z.string().min(1).max(200),
  netAmount: z.number().optional(),
  rebateAmount: z.number().optional(),
});

export const publishProjectBodySchema = z.object({
  bvid: z.string().min(1).max(32),
  publishedAt: z.string().datetime(),
  idempotencyKey: z.string().min(1).max(200),
});

export const hermesOperationSchema = z.enum([
  'upsert_project',
  'upsert_open_item',
  'close_open_item',
  'advance_node',
  'rollback_node',
  'publish_video',
]);

export const hermesWriteBodySchema = z.object({
  projectId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(1).max(200),
  operation: hermesOperationSchema,
  payload: z.record(z.unknown()),
  sourceEvidence: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).default(0),
  autoApply: z.boolean().default(false),
});

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
    items: z.array(item),
  });
}

export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;
export type OpenItemDto = z.infer<typeof openItemSchema>;
export type HomeDashboard = z.infer<typeof homeDashboardSchema>;

export type ApiErrorBody = {
  error: string;
  requestId?: string;
  details?: unknown;
};
