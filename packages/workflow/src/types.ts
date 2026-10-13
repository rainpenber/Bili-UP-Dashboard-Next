export const NODE_STATUSES = [
  'locked',
  'ready',
  'in_progress',
  'waiting_external',
  'blocked',
  'completed',
  'skipped',
] as const;

export type NodeStatus = (typeof NODE_STATUSES)[number];

export const DEPENDENCY_MODES = ['all_of', 'any_of'] as const;
export type DependencyMode = (typeof DEPENDENCY_MODES)[number];

export const PROJECT_STAGES = [
  'business_init',
  'outline',
  'copywriting',
  'production',
  'review',
  'publish',
  'go_live_monitoring',
  'settlement',
  'completed',
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export type WorkflowNodeSnapshot = {
  id: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  isRequired: boolean;
  dependencyMode: DependencyMode;
  status: NodeStatus;
  stageKey: string | null;
  blockedReason: string | null;
};

export type WorkflowDependency = {
  nodeId: string;
  dependsOnId: string;
};
