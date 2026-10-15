import type {
  CommercialProjectWorkflow,
  TemplateVersionGraph,
  WfNodeStatus,
} from '@studio/contracts';
import type { WorkflowGraph, WorkflowNodeStatus } from './types';

function visualStatus(status: WfNodeStatus): WorkflowNodeStatus {
  if (status === 'completed') return 'done';
  if (status === 'in_progress') return 'in_progress';
  if (status === 'blocked') return 'blocked';
  return 'not_reached';
}

export function templateVersionToWorkflowGraph(version: TemplateVersionGraph): WorkflowGraph {
  return {
    steps: version.nodes.map((node) => ({
      kind: 'serial' as const,
      node: { id: node.id, name: node.name, status: 'not_reached' as const },
    })),
    connections: version.edges.map((edge) => ({ from: edge.fromNodeId, to: edge.toNodeId })),
  };
}

export function projectWorkflowToGraph(workflow: CommercialProjectWorkflow): WorkflowGraph {
  return {
    steps: workflow.nodes.map((node) => ({
      kind: 'serial' as const,
      node: { id: node.id, name: node.name, status: visualStatus(node.status) },
    })),
    connections: workflow.edges.map((edge) => ({ from: edge.fromNodeId, to: edge.toNodeId })),
  };
}

export function nextTemplateNodePosition(nodes: Array<{ posX: number; posY: number }>): {
  posX: number;
  posY: number;
} {
  if (nodes.length === 0) return { posX: 0, posY: 0 };
  const maxY = nodes.reduce((max, node) => Math.max(max, node.posY), 0);
  return { posX: 0, posY: maxY + 120 };
}
