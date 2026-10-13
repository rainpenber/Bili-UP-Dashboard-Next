import { PROJECT_STAGES, type ProjectStage, type WorkflowNodeSnapshot } from './types';

const STAGE_ORDER: ProjectStage[] = [...PROJECT_STAGES];

function stageNodes(nodes: WorkflowNodeSnapshot[]): WorkflowNodeSnapshot[] {
  return nodes.filter((n) => n.stageKey && n.parentId == null && n.isRequired);
}

export function deriveProjectStage(nodes: WorkflowNodeSnapshot[]): ProjectStage {
  const roots = stageNodes(nodes).sort((a, b) => a.sortOrder - b.sortOrder);
  for (const stage of STAGE_ORDER) {
    if (stage === 'completed') continue;
    const node = roots.find((n) => n.stageKey === stage);
    if (!node) continue;
    if (node.status !== 'completed' && node.status !== 'skipped') {
      return stage;
    }
  }
  return 'completed';
}

export function deriveHealthStatus(
  nodes: WorkflowNodeSnapshot[],
  hasOpenOurItems: boolean,
  hasOverdue: boolean,
): 'healthy' | 'at_risk' | 'blocked' {
  if (nodes.some((n) => n.status === 'blocked')) return 'blocked';
  if (hasOverdue || hasOpenOurItems) return 'at_risk';
  return 'healthy';
}

export const STAGE_LABELS: Record<ProjectStage, string> = {
  business_init: '商务与立项',
  outline: '大纲',
  copywriting: '文案',
  production: '制作',
  review: '审核',
  publish: '发布',
  go_live_monitoring: '上线监控',
  settlement: '结算与资产收尾',
  completed: '已完成',
};
