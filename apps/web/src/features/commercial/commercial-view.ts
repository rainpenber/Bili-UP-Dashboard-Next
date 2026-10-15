import type {
  CommercialDefaultTemplate,
  CommercialProjectListItem,
  CommercialProjectWorkflow,
  OverallStage,
  WfNodeStatus,
} from '@studio/contracts';
import type { WorkflowGraph, WorkflowGraphNode, WorkflowNodeStatus } from './types';

export const OVERALL_STAGE_LABEL: Record<OverallStage, string> = {
  pre_publish: '发布前',
  published_winding_down: '已发布，收尾中',
  closed: '已结案',
  archived: '已归档',
};

export function overallStageLabel(stage: OverallStage): string {
  return OVERALL_STAGE_LABEL[stage];
}

export function formatMoney(amount: string | null): string {
  if (amount == null) return '未填写';
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function stageSummary(item: {
  currentStageNames: readonly string[];
  overallStage: OverallStage;
}): string {
  if (item.currentStageNames.length > 0) return item.currentStageNames.join('、');
  return overallStageLabel(item.overallStage);
}

export function toVisualStatus(status: WfNodeStatus): WorkflowNodeStatus {
  if (status === 'completed') return 'done';
  return status;
}

export function isPublishNodeName(name: string): boolean {
  return name === '发布';
}

export function graphFromWorkflow(
  workflow: CommercialProjectWorkflow,
  options: { blockingReason: string | null },
): WorkflowGraph {
  const blocked = workflow.nodes.filter((node) => node.status === 'blocked');
  const soleBlockedId = blocked.length === 1 ? blocked[0]?.id : undefined;
  const steps = workflow.nodes.map((node) => {
    const graphNode: WorkflowGraphNode = {
      id: node.id,
      name: node.name,
      status: toVisualStatus(node.status),
      apiStatus: node.status,
      updatedAt: node.updatedAt,
      isOptional: node.isOptional,
      isPublish: isPublishNodeName(node.name),
      kind: node.kind,
    };
    if (soleBlockedId === node.id && options.blockingReason) {
      graphNode.blockingReason = options.blockingReason;
    }
    return { kind: 'serial' as const, node: graphNode };
  });
  return {
    steps,
    connections: workflow.edges.map((edge) => ({
      from: edge.fromNodeId,
      to: edge.toNodeId,
    })),
  };
}

export function graphFromTemplate(template: CommercialDefaultTemplate): WorkflowGraph {
  return {
    steps: template.nodes.map((node) => ({
      kind: 'serial' as const,
      node: {
        id: node.id,
        name: node.name,
        status: 'not_reached' as const,
        apiStatus: 'not_reached' as const,
        isOptional: node.isOptional,
        isPublish: isPublishNodeName(node.name),
        kind: node.kind,
      },
    })),
    connections: template.edges.map((edge) => ({
      from: edge.fromNodeId,
      to: edge.toNodeId,
    })),
  };
}

export function filterCommercialProjects(
  items: readonly CommercialProjectListItem[],
  keyword: string,
): CommercialProjectListItem[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [...items];
  return items.filter((item) => {
    const hay = [item.name, overallStageLabel(item.overallStage), ...item.currentStageNames]
      .join('\n')
      .toLowerCase();
    return hay.includes(kw);
  });
}

const STAGE_RANK: Record<OverallStage, number> = {
  pre_publish: 0,
  published_winding_down: 1,
  closed: 2,
  archived: 3,
};

export function sortCommercialProjects(
  items: readonly CommercialProjectListItem[],
): CommercialProjectListItem[] {
  return [...items].sort((a, b) => {
    if (a.anyNodeBlocked !== b.anyNodeBlocked) return a.anyNodeBlocked ? -1 : 1;
    return STAGE_RANK[a.overallStage] - STAGE_RANK[b.overallStage];
  });
}

export function blockedProjects(
  items: readonly CommercialProjectListItem[],
): CommercialProjectListItem[] {
  return items.filter((item) => item.anyNodeBlocked);
}

export function movingProjects(
  items: readonly CommercialProjectListItem[],
): CommercialProjectListItem[] {
  return items.filter(
    (item) =>
      !item.anyNodeBlocked && item.currentStageNames.length > 0 && item.overallStage !== 'archived',
  );
}
