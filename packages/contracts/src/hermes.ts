import { z } from 'zod';
import { nodePhaseSchema, openItemBodyBaseSchema, publishProjectBodySchema } from './commercial';

const uuid = z.string().uuid();

export const hermesProjectUpsertPayloadSchema = z.object({
  projectId: uuid.optional(),
  name: z.string().min(1).max(200),
  netAmount: z.number().optional(),
  rebateAmount: z.number().optional(),
});

export const hermesNodeIdPayloadSchema = z.object({
  projectId: uuid,
  nodeId: uuid,
});

export const hermesGraphNodeCreatePayloadSchema = z.object({
  projectId: uuid,
  name: z.string().min(1).max(200),
  posX: z.number(),
  posY: z.number(),
  phase: nodePhaseSchema.optional(),
  packageId: uuid.nullable().optional(),
  connectFromNodeId: uuid.optional(),
  connectToNodeId: uuid.optional(),
});

export const hermesGraphNodeUpdatePayloadSchema = z.object({
  projectId: uuid,
  nodeId: uuid,
  name: z.string().min(1).max(200).optional(),
  posX: z.number().optional(),
  posY: z.number().optional(),
  plannedAt: z.string().datetime().nullable().optional(),
  phase: nodePhaseSchema.optional(),
  packageId: uuid.nullable().optional(),
});

export const hermesGraphEdgePayloadSchema = z.object({
  projectId: uuid,
  fromNodeId: uuid,
  toNodeId: uuid,
});

export const hermesGraphEdgeDeletePayloadSchema = z.object({
  projectId: uuid,
  edgeId: uuid,
});

export const hermesGraphNodeDeletePayloadSchema = z.object({
  projectId: uuid,
  nodeId: uuid,
});

export const hermesOpenItemCreatePayloadSchema = openItemBodyBaseSchema
  .extend({ projectId: uuid })
  .superRefine((data, ctx) => {
    if (data.impact === 'blocking' && !data.blocksNodeId) {
      ctx.addIssue({
        code: 'custom',
        message: 'blocking item requires blocksNodeId',
        path: ['blocksNodeId'],
      });
    }
  });

export const hermesOpenItemUpdatePayloadSchema = openItemBodyBaseSchema
  .partial()
  .extend({ projectId: uuid, itemId: uuid });

export const hermesOpenItemClosePayloadSchema = z.object({
  projectId: uuid,
  itemId: uuid,
  conclusion: z.string().min(1).max(5000),
});

export const hermesOpenItemCancelPayloadSchema = z.object({
  projectId: uuid,
  itemId: uuid,
  reason: z.string().min(1).max(2000),
});

export const hermesOpenItemSplitPayloadSchema = z.object({
  projectId: uuid,
  itemId: uuid,
  newTitles: z.array(z.string().min(1).max(300)).min(2).max(5),
});

export const hermesOpenItemMergePayloadSchema = z.object({
  projectId: uuid,
  itemIds: z.array(uuid).min(2).max(10),
  mergedTitle: z.string().min(1).max(300),
});

export const hermesOpenItemPromotePayloadSchema = z.object({
  projectId: uuid,
  itemId: uuid,
  nodeName: z.string().min(1).max(200),
  posX: z.number().optional(),
  posY: z.number().optional(),
});

export const hermesPublishPayloadSchema = publishProjectBodySchema.extend({
  projectId: uuid,
});

export const hermesResetWorkflowPayloadSchema = z.object({
  projectId: uuid,
  templateVersionId: uuid,
  confirmDestroyCustomGraph: z.literal(true),
});

export const hermesWriteEnvelopeSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('upsert_project'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesProjectUpsertPayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('advance_node'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesNodeIdPayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('complete_node'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesNodeIdPayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('rollback_node'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesNodeIdPayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('mark_node_not_applicable'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesNodeIdPayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('add_graph_node'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesGraphNodeCreatePayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('update_graph_node'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesGraphNodeUpdatePayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('delete_graph_node'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesGraphNodeDeletePayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('add_graph_edge'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesGraphEdgePayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('delete_graph_edge'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesGraphEdgeDeletePayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('create_open_item'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesOpenItemCreatePayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('update_open_item'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesOpenItemUpdatePayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('close_open_item'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesOpenItemClosePayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('cancel_open_item'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesOpenItemCancelPayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('split_open_item'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesOpenItemSplitPayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('merge_open_items'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesOpenItemMergePayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('promote_open_item_to_node'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesOpenItemPromotePayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('publish_video'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesPublishPayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal('reset_project_workflow'),
    idempotencyKey: z.string().min(1).max(200),
    payload: hermesResetWorkflowPayloadSchema,
    sourceEvidence: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    autoApply: z.boolean().default(false),
  }),
]);

export type HermesWriteEnvelope = z.infer<typeof hermesWriteEnvelopeSchema>;

export const hermesProposalSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  idempotencyKey: z.string(),
  operation: z.string(),
  status: z.enum(['pending', 'accepted', 'rejected']),
  payload: z.unknown(),
  confidence: z.number(),
  rejectionReason: z.string().nullable(),
  resultJson: z.unknown().nullable(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});
