/** 工作流节点在只读图上的展示状态。`done` 对应接口的 `completed`。 */
export type WorkflowNodeStatus =
  'done' | 'in_progress' | 'blocked' | 'not_reached' | 'not_applicable';

/** 与写入接口一致的节点状态。 */
export type WorkflowApiStatus =
  'not_reached' | 'in_progress' | 'completed' | 'blocked' | 'not_applicable';

export type OpenItemSide = 'ours' | 'client';

/** 待办/沟通事项（一条开放事项，不因聊天条数拆分） */
export interface CommercialOpenItem {
  id: string;
  projectId: string;
  title: string;
  nextAction: string;
  /** 如「3月8日前」「本周内」 */
  plannedTime?: string;
  side: OpenItemSide;
  /** 是否卡住主流程节点 */
  isBlocking: boolean;
}

export interface WorkflowGraphNode {
  id: string;
  name: string;
  status: WorkflowNodeStatus;
  /** 写入接口使用的状态。演示图可以不填。 */
  apiStatus?: WorkflowApiStatus;
  /** 最近一次读取返回的并发令牌，按原文字符串保存。 */
  updatedAt?: string;
  isOptional?: boolean;
  /** 名称为「发布」的节点，完成时走发布接口。 */
  isPublish?: boolean;
  kind?: 'stage' | 'merge';
  /** 未完成节点的计划时间，如「3月2日」 */
  plannedDateLabel?: string;
  /** 已完成节点的实际时间 */
  finishedDateLabel?: string;
  blockingReason?: string;
}

export type WorkflowGraphStep =
  { kind: 'serial'; node: WorkflowGraphNode } | { kind: 'parallel'; nodes: WorkflowGraphNode[] };

/** Explicit directed edge between two real workflow nodes (no routing/junction ids). */
export interface WorkflowConnection {
  from: string;
  to: string;
}

export interface WorkflowGraph {
  steps: WorkflowGraphStep[];
  /**
   * When set, layout and structural editing use these edges instead of step-derived
   * connectivity. Status-only edits leave this unset so the original step DAG layout
   * is unchanged.
   */
  connections?: WorkflowConnection[];
}

export interface DefaultFlowPublishedVersion {
  id: string;
  version: number;
  publishedAtLabel: string;
  graph: WorkflowGraph;
}

export interface DefaultFlowWorkspace {
  title: string;
  description: string;
  draft: WorkflowGraph;
  /** Last saved draft snapshot (may equal draft). */
  savedDraft: WorkflowGraph;
  publishedVersions: DefaultFlowPublishedVersion[];
  /** Currently viewed published version id, or null when editing the draft. */
  viewingVersionId: string | null;
}

export type ProjectListBucket =
  'blocked_with_reason' | 'in_progress' | 'published_winding_down' | 'archived';

export interface CommercialProject {
  id: string;
  name: string;
  /** 列表卡片上显示的当前/阻塞阶段 */
  stageLabel: string;
  listBucket: ProjectListBucket;
  /** 是否有明确阻塞原因（用于排序） */
  hasConcreteBlockReason: boolean;
  blockedNodeName?: string;
  blockedDays?: number;
  userFacingDeadline?: string;
  /** 概要区 */
  overallStage: string;
  inProgressNodeNames: string[];
  mainBlockingItem?: string;
  netAmountYuan: number;
  rebateAmountYuan: number;
  /** 未完成节点的计划时间摘要 */
  upcomingNodeSchedule: { name: string; dateLabel: string }[];
  finishedNodeSchedule: { name: string; dateLabel: string }[];
  /** 当前状态区 */
  statusHeadline: string;
  blockingReason?: string;
  published: boolean;
  bvid?: string;
  goLiveAtLabel?: string;
  archived: boolean;
  openItems: CommercialOpenItem[];
  workflow: WorkflowGraph;
  /** 用于关键字/时间筛选 */
  keywordHaystack: string;
  /** ISO 日期，用于时间筛选 */
  sortDate: string;
}

export interface BlockedProjectSummary {
  projectId: string;
  projectName: string;
  blockedNode: string;
  mainBlockingItem: string;
  userFacingDeadline: string;
  blockedDays: number;
}

export interface DefaultWorkflowTemplate {
  title: string;
  description: string;
  graph: WorkflowGraph;
}
