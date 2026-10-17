import type { CommercialProjectDetail, CommercialWorkflowNode } from '@studio/contracts';
import { toDemoStatus } from './workflow-status-map';
import type { MockStatus } from '../workflow-mock/flow-nodes';

/**
 * Achievement points are the dots. Stages are the lines between them.
 * Workflow node ids here are template slugs, not instance UUIDs.
 * 「手工」is not its own node yet; it stays inside 文案准备.
 * 「AI 生成」and「后期剪辑」are still the single template node `ai_post`.
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
    nodeIds: ['a_roll', 'b_roll', 'ai_post'],
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
  'AI 后期': 'ai_post',
  'AI 生成': 'ai_post',
  后期剪辑: 'ai_post',
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
};

export type TimelineChild = {
  id: string;
  nodeId: string;
  name: string;
  status: string;
  demoStatus: MockStatus;
  statusLabel: string;
  blockingReason: string | null;
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
  overallStageLabel: string;
  currentTasks: string[];
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

/**
 * Phrase above a blocked or in-progress stage, in the same role as 花火's 「待UP主投稿」.
 * Null when the stage is finished or not started.
 */
export function stageSituationLabel(stage: {
  status: TimelineRollup;
  children: { name: string; status: string }[];
  blockers: { name: string; blockingReason: string | null }[];
}): string | null {
  if (stage.status === 'blocked') {
    const blocker = stage.blockers[0];
    if (!blocker) return '阻塞';
    return blocker.blockingReason ?? `${blocker.name}阻塞`;
  }
  if (stage.status === 'in_progress') {
    const names = stage.children
      .filter((child) => child.status === 'in_progress')
      .map((child) => child.name);
    return names.length > 0 ? names.join('、') : '进行中';
  }
  return null;
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
  const applicable = children.filter((child) => child.status !== 'not_applicable');
  if (applicable.length === 0) return 'not_reached';
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
  return {
    netAmount: detail.netAmount,
    rebateAmount: detail.rebateAmount,
    overallStageLabel: OVERALL_STAGE_LABEL[detail.overallStage] ?? detail.overallStage,
    currentTasks: detail.currentStageNames,
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
  }));
}
