/** 工作流节点在只读图上的展示状态 */
export type WorkflowNodeStatus = 'done' | 'in_progress' | 'blocked' | 'not_reached';

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
  /** 未完成节点的计划时间，如「3月2日」 */
  plannedDateLabel?: string;
  /** 已完成节点的实际时间 */
  finishedDateLabel?: string;
  blockingReason?: string;
}

/** 纵向主链；parallelGroups 为同一阶段的并行分支（横向排列） */
export interface WorkflowGraphSection {
  id: string;
  /** 主链节点（纵向） */
  nodes: WorkflowGraphNode[];
  /** 并行组：每组内节点横向并列，组与组之间仍纵向连接 */
  parallelGroups?: WorkflowGraphNode[][];
}

export interface WorkflowGraph {
  sections: WorkflowGraphSection[];
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
