import type { CommercialProjectDetail, CommercialWorkflowNode } from '@studio/contracts';
import { toDemoStatus } from './workflow-status-map';
import type { MockStatus } from '../workflow-mock/flow-nodes';

/**
 * Achievement points are the dots. Stages are the lines between them.
 * Workflow node ids here are template slugs, not instance UUIDs.
 * 「手工」is not its own node yet; it stays inside 文案准备.
 * 「剪辑」is its own template node `edit`, before AI 后期 (`ai_post`).
 */
export const ACHIEVEMENT_POINTS = [
  { id: 'inquiry', label: '询单' },
  { id: 'outline_locked', label: '大纲确定' },
  { id: 'script_locked', label: '脚本确定' },
  { id: 'edit_done', label: '剪辑完成' },
  { id: 'published', label: '发布上线' },
  { id: 'closed', label: '商单完结' },
] as const;

export type AchievementPointId = (typeof ACHIEVEMENT_POINTS)[number]['id'];

export const PROGRESS_STAGES = [
  {
    id: 'write_outline',
    label: '写大纲',
    from: 'inquiry',
    to: 'outline_locked',
    nodeIds: ['outline'],
  },
  {
    id: 'copy_prep',
    label: '文案准备',
    from: 'outline_locked',
    to: 'script_locked',
    nodeIds: ['copy', 'pre_shoot', 'manual'],
  },
  {
    id: 'production',
    label: '拍摄制作',
    from: 'script_locked',
    to: 'edit_done',
    nodeIds: ['a_roll', 'b_roll', 'edit', 'ai_post'],
  },
  {
    id: 'client_review',
    label: '甲方审核',
    from: 'edit_done',
    to: 'published',
    nodeIds: ['review', 'publish'],
  },
  {
    id: 'distribution_settlement',
    label: '分发结算',
    from: 'published',
    to: 'closed',
    nodeIds: ['distribution', 'settlement', 'data_maint', 'other'],
  },
] as const;

export type ProgressStageId = (typeof PROGRESS_STAGES)[number]['id'];

export type TimelineRollup = 'completed' | 'blocked' | 'in_progress' | 'not_reached';

const STAGE_BY_NODE_ID: Record<string, ProgressStageId> = {};
for (const stage of PROGRESS_STAGES) {
  for (const nodeId of stage.nodeIds) STAGE_BY_NODE_ID[nodeId] = stage.id;
}

/** Default display names, used when a workflow row has no template slug. */
const NAME_TO_NODE_ID: Record<string, string> = {
  询单: 'inquiry',
  大纲: 'outline',
  文案: 'copy',
  预拍摄: 'pre_shoot',
  手工: 'manual',
  'A-roll 拍摄': 'a_roll',
  'B-roll 素材': 'b_roll',
  剪辑: 'edit',
  后期剪辑: 'edit',
  'AI 后期': 'ai_post',
  'AI 生成': 'ai_post',
  审核: 'review',
  发布: 'publish',
  全平台分发: 'distribution',
  结算: 'settlement',
  数据维护: 'data_maint',
  其他: 'other',
  汇合节点: 'merge',
};

const OVERALL_STAGE_LABEL: Record<string, string> = {
  pre_publish: '发布前',
  published_winding_down: '已上线，收尾中',
  closed: '已结案',
  archived: '已归档',
};

export type TimelineSourceNode = {
  id: string;
  name: string;
  status: string;
  kind?: 'stage' | 'merge' | string;
  templateSlug?: string | null;
  blockingReason?: string | null;
  /** ISO instant. Shanghai midnight is a calendar date, not an agreed 00:00. */
  plannedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string;
};

export type TimelineChild = {
  id: string;
  nodeId: string;
  name: string;
  status: string;
  demoStatus: MockStatus;
  statusLabel: string;
  blockingReason: string | null;
  plannedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
};

export type DerivedStage = {
  id: ProgressStageId;
  label: string;
  from: AchievementPointId;
  to: AchievementPointId;
  status: TimelineRollup;
  demoStatus: MockStatus;
  current: boolean;
  children: TimelineChild[];
  blockers: TimelineChild[];
};

export type DerivedPoint = {
  id: AchievementPointId;
  label: string;
  status: TimelineRollup;
  demoStatus: MockStatus;
};

export type DerivedTimeline = {
  points: DerivedPoint[];
  stages: DerivedStage[];
};

export type TimelineProjectFacts = {
  netAmount: string | null;
  rebateAmount: string | null;
  overallStage: string;
  overallStageLabel: string;
  currentTasks: string[];
  published: boolean;
  publishedAt: string | null;
  blockingReason: string | null;
};

export function stageIdForNode(nodeId: string): ProgressStageId | null {
  return STAGE_BY_NODE_ID[nodeId] ?? null;
}

export function resolveTimelineNodeId(node: {
  templateSlug?: string | null;
  name: string;
}): string | null {
  if (node.templateSlug && node.templateSlug.trim().length > 0) return node.templateSlug;
  return NAME_TO_NODE_ID[node.name] ?? null;
}

type SituationStage = {
  status: TimelineRollup;
  children: { name: string; status: string }[];
  blockers: { name: string; blockingReason: string | null }[];
};

/** 「节点名：阻塞」 for every blocked child, in stage order. Reasons stay off this line. */
export function stageBlockLineLabel(stage: {
  status: TimelineRollup;
  blockers: { name: string; blockingReason: string | null }[];
}): string | null {
  if (stage.status !== 'blocked') return null;
  if (stage.blockers.length === 0) return '阻塞';
  return stage.blockers.map((blocker) => `${blocker.name}：阻塞`).join('、');
}

/**
 * Phrase above a blocked or in-progress stage, in the same role as 花火's 「待UP主投稿」.
 * Blocked stages name each node and the word 阻塞. The reason stays in the tooltip and detail.
 * Null when finished or not started.
 */
export function stageSituationLabel(stage: SituationStage): string | null {
  if (stage.status === 'blocked') return stageBlockLineLabel(stage);
  if (stage.status === 'in_progress') {
    const names = stage.children
      .filter((child) => child.status === 'in_progress')
      .map((child) => child.name);
    return names.length > 0 ? names.join('、') : '进行中';
  }
  return null;
}

export type NodeStepActionId = 'start' | 'complete' | 'rollback' | 'unblock';

export type NodeStepActionSpec = {
  id: NodeStepActionId;
  label: string;
  endpoint: 'step' | 'unblock';
  direction: 'forward' | 'rollback' | null;
  enabled: boolean;
  /** Shown on hover when a node must be completed through its own write path. */
  hint?: string;
};

export const PUBLISH_COMPLETE_HINT = '发布节点请用发布按钮填写链接';

/**
 * State-exact actions for one node row in the stage tooltip.
 * 进行中 / 完成 / 回退 are always present so the row keeps a predictable shape.
 * Blocked nodes get one extra 解除阻塞 action.
 */
export function deriveNodeStepActions(
  status: string,
  options: { nodeId?: string | null } = {},
): NodeStepActionSpec[] {
  const isPublish = options.nodeId === 'publish';
  const canStart = status === 'not_reached';
  const canComplete = status === 'in_progress' && !isPublish;
  const canRollback =
    status === 'in_progress' ||
    status === 'completed' ||
    status === 'not_applicable' ||
    status === 'blocked';
  const actions: NodeStepActionSpec[] = [
    {
      id: 'start',
      label: '进行中',
      endpoint: 'step',
      direction: 'forward',
      enabled: canStart,
    },
    {
      id: 'complete',
      label: '完成',
      endpoint: 'step',
      direction: 'forward',
      enabled: canComplete,
      ...(isPublish ? { hint: PUBLISH_COMPLETE_HINT } : {}),
    },
    {
      id: 'rollback',
      label: '回退',
      endpoint: 'step',
      direction: 'rollback',
      enabled: canRollback,
    },
  ];
  if (status === 'blocked') {
    actions.push({
      id: 'unblock',
      label: '解除阻塞',
      endpoint: 'unblock',
      direction: null,
      enabled: true,
    });
  }
  return actions;
}

/** Ids of the actions that may actually be clicked for this node status. */
export function availableNodeStepActions(
  status: string,
  options: { nodeId?: string | null } = {},
): NodeStepActionId[] {
  return deriveNodeStepActions(status, options)
    .filter((action) => action.enabled)
    .map((action) => action.id);
}

export function timelineStatusLabel(status: string): string {
  switch (status) {
    case 'completed':
    case 'done':
      return '完成';
    case 'blocked':
      return '阻塞';
    case 'in_progress':
      return '进行中';
    case 'not_applicable':
    case 'not_reached':
    default:
      return '未完成';
  }
}

function rollup(children: TimelineChild[]): TimelineRollup {
  if (children.some((child) => child.status === 'blocked')) return 'blocked';
  if (children.length === 0) return 'not_reached';
  const applicable = children.filter((child) => child.status !== 'not_applicable');
  if (applicable.length === 0) return 'completed';
  if (applicable.every((child) => child.status === 'completed' || child.status === 'done')) {
    return 'completed';
  }
  if (applicable.every((child) => child.status === 'not_reached')) return 'not_reached';
  return 'in_progress';
}

function pointStatusFromNode(status: string | undefined): TimelineRollup {
  switch (status) {
    case 'completed':
    case 'done':
      return 'completed';
    case 'blocked':
      return 'blocked';
    case 'in_progress':
      return 'in_progress';
    default:
      return 'not_reached';
  }
}

export function deriveProgressTimeline(nodes: TimelineSourceNode[]): DerivedTimeline {
  const grouped = new Map<ProgressStageId, TimelineChild[]>();
  for (const stage of PROGRESS_STAGES) grouped.set(stage.id, []);

  let inquiryStatus: string | undefined;
  for (const node of nodes) {
    if (node.kind === 'merge') continue;
    const nodeId = resolveTimelineNodeId(node);
    if (!nodeId || nodeId === 'merge') continue;
    if (nodeId === 'inquiry') {
      inquiryStatus = node.status;
      continue;
    }
    const stageId = stageIdForNode(nodeId);
    if (!stageId) continue;
    const reason =
      node.status === 'blocked' && node.blockingReason && node.blockingReason.trim().length > 0
        ? node.blockingReason
        : null;
    grouped.get(stageId)?.push({
      id: node.id,
      nodeId,
      name: node.name,
      status: node.status,
      demoStatus: toDemoStatus(node.status),
      statusLabel: timelineStatusLabel(node.status),
      blockingReason: reason,
      plannedAt: node.plannedAt ?? null,
      completedAt: node.completedAt ?? null,
      updatedAt: node.updatedAt ?? null,
    });
  }

  const stages: DerivedStage[] = PROGRESS_STAGES.map((stage) => {
    const found = grouped.get(stage.id) ?? [];
    const rank = new Map<string, number>(stage.nodeIds.map((id, index) => [id, index]));
    const children = [...found].sort((a, b) => {
      const left = rank.get(a.nodeId) ?? stage.nodeIds.length;
      const right = rank.get(b.nodeId) ?? stage.nodeIds.length;
      if (left !== right) return left - right;
      return a.name.localeCompare(b.name, 'zh');
    });
    const status = rollup(children);
    return {
      id: stage.id,
      label: stage.label,
      from: stage.from,
      to: stage.to,
      status,
      demoStatus: toDemoStatus(status),
      current: false,
      children,
      blockers: children.filter((child) => child.status === 'blocked'),
    };
  });

  const current = stages.find((stage) => stage.status !== 'completed');
  if (current) current.current = true;

  const stageByEnd = new Map(stages.map((stage) => [stage.to, stage]));
  const points: DerivedPoint[] = ACHIEVEMENT_POINTS.map((point) => {
    if (point.id === 'inquiry') {
      const status = pointStatusFromNode(inquiryStatus);
      return { id: point.id, label: point.label, status, demoStatus: toDemoStatus(status) };
    }
    const incoming = stageByEnd.get(point.id);
    const status: TimelineRollup = incoming?.status === 'completed' ? 'completed' : 'not_reached';
    return { id: point.id, label: point.label, status, demoStatus: toDemoStatus(status) };
  });

  return { points, stages };
}

export function timelineFactsFromDetail(
  detail: CommercialProjectDetail | null | undefined,
): TimelineProjectFacts | null {
  if (!detail) return null;
  const storedLabel = OVERALL_STAGE_LABEL[detail.overallStage] ?? detail.overallStage;
  const overallStageLabel =
    detail.businessState === 'finished'
      ? '已结束'
      : detail.businessState === 'not_started'
        ? '未开始'
        : storedLabel;
  return {
    netAmount: detail.netAmount,
    rebateAmount: detail.rebateAmount,
    overallStage: detail.overallStage,
    overallStageLabel,
    currentTasks: detail.currentStageNames,
    published: detail.publish.published || detail.overallStage === 'published_winding_down',
    publishedAt: detail.publish.published ? detail.publish.publishedAt : null,
    blockingReason: detail.blockingReason,
  };
}

export function timelineNodesFromWorkflow(
  nodes: CommercialWorkflowNode[],
  names: Record<string, string> = {},
): TimelineSourceNode[] {
  return nodes.map((node) => ({
    id: node.id,
    name: names[node.id] ?? node.name,
    status: node.status,
    kind: node.kind,
    templateSlug: node.templateSlug,
    blockingReason: node.blockingReason,
    plannedAt: node.plannedAt,
    completedAt: node.completedAt,
    updatedAt: node.updatedAt,
  }));
}
