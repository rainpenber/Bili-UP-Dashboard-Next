/** DB-backed commercial domain enums (mirror CHECK constraints in 004_commercial_domain.sql). */

export const OVERALL_STAGES = [
  'pre_publish',
  'published_winding_down',
  'closed',
  'archived',
] as const;
export type OverallStage = (typeof OVERALL_STAGES)[number];

export const WF_NODE_STATUSES = [
  'not_reached',
  'in_progress',
  'completed',
  'blocked',
  'not_applicable',
] as const;
export type WfNodeStatus = (typeof WF_NODE_STATUSES)[number];

export const WF_NODE_PHASES = [
  'pre_publish',
  'post_publish_required',
  'post_publish_optional',
] as const;
export type WfNodePhase = (typeof WF_NODE_PHASES)[number];

export const OPEN_ITEM_LIFECYCLES = ['open', 'closed', 'cancelled'] as const;
export type OpenItemLifecycle = (typeof OPEN_ITEM_LIFECYCLES)[number];

export const OPEN_ITEM_IMPACTS = ['normal', 'blocking'] as const;
export type OpenItemImpact = (typeof OPEN_ITEM_IMPACTS)[number];

export const NEXT_ACTORS = ['us', 'client'] as const;
export type NextActor = (typeof NEXT_ACTORS)[number];

export const PUBLISH_SOURCES = ['web', 'hermes', 'manual'] as const;
export type PublishSource = (typeof PUBLISH_SOURCES)[number];

export const MONITOR_JOB_TYPES = ['metadata', 'metrics'] as const;
export type MonitorJobType = (typeof MONITOR_JOB_TYPES)[number];

export const HERMES_PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type HermesProposalStatus = (typeof HERMES_PROPOSAL_STATUSES)[number];

export type CommercialProjectRow = {
  id: string;
  name: string;
  netAmount: string | null;
  rebateAmount: string | null;
  overallStage: OverallStage;
  userDeadlineAt: Date | null;
  archivedAt: Date | null;
  businessClosedAt: Date | null;
  stageEnteredAt: Date;
  blockedSinceAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DomainAuditEventRow = {
  id: number;
  projectId: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  detail: Record<string, unknown>;
  source: string;
  createdAt: Date;
};
