import type { WorkflowGraph, WorkflowGraphNode, WorkflowNodeStatus } from './types';

export type FlatGraphRow =
  { kind: 'node'; node: WorkflowGraphNode } | { kind: 'parallel'; nodes: WorkflowGraphNode[] };

/** 将分段图展开为纵向行（并行组为一行） */
export function flattenWorkflowGraph(graph: WorkflowGraph): FlatGraphRow[] {
  const rows: FlatGraphRow[] = [];
  for (const section of graph.sections) {
    for (const n of section.nodes) {
      rows.push({ kind: 'node', node: n });
    }
    if (section.parallelGroups) {
      for (const group of section.parallelGroups) {
        if (group.length > 0) rows.push({ kind: 'parallel', nodes: group });
      }
    }
  }
  return rows;
}

export function workflowNodeStatusClass(status: WorkflowNodeStatus): string {
  switch (status) {
    case 'done':
      return 'border-success/50 bg-success/15 text-success-foreground';
    case 'in_progress':
      return 'border-warning/50 bg-warning/15 text-warning-foreground';
    case 'blocked':
      return 'border-destructive/50 bg-destructive/15 text-destructive-foreground';
    default:
      return 'border-border bg-muted/40 text-muted-foreground';
  }
}

export function workflowNodeStatusLabel(status: WorkflowNodeStatus): string {
  switch (status) {
    case 'done':
      return '已完成';
    case 'in_progress':
      return '进行中';
    case 'blocked':
      return '被卡住';
    default:
      return '未到';
  }
}
