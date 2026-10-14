import type {
  WorkflowGraph,
  WorkflowGraphNode,
  WorkflowGraphStep,
  WorkflowNodeStatus,
} from './types';

export type FlatGraphRow =
  | { kind: 'serial'; node: WorkflowGraphNode }
  | { kind: 'parallel'; nodes: WorkflowGraphNode[]; joinId: string };

/** 将流程展开为纵向行；并行组在同一行且带汇合 id */
export function flattenWorkflowGraph(graph: WorkflowGraph): FlatGraphRow[] {
  return graph.steps.map((step, index) => {
    if (step.kind === 'serial') {
      return { kind: 'serial', node: step.node };
    }
    return { kind: 'parallel', nodes: step.nodes, joinId: `parallel-${index}` };
  });
}

export function parallelSiblingCount(rows: FlatGraphRow[]): number[] {
  return rows
    .filter((r): r is Extract<FlatGraphRow, { kind: 'parallel' }> => r.kind === 'parallel')
    .map((r) => r.nodes.length);
}

export function hasForkJoinPair(rows: FlatGraphRow[]): boolean {
  const parallel = rows.filter((r) => r.kind === 'parallel');
  return parallel.some((r) => r.kind === 'parallel' && r.nodes.length >= 2);
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

export function countSteps(graph: WorkflowGraph): { serial: number; parallel: number } {
  let serial = 0;
  let parallel = 0;
  for (const step of graph.steps) {
    if (step.kind === 'serial') serial += 1;
    else parallel += 1;
  }
  return { serial, parallel };
}

export function includesPostPublishWindDown(graph: WorkflowGraph): boolean {
  return graph.steps.some(
    (step) =>
      step.kind === 'parallel' &&
      step.nodes.some((n) => n.id === 'settle' || n.name.includes('结算')),
  );
}

export function isPrepParallelStep(step: WorkflowGraphStep): boolean {
  return (
    step.kind === 'parallel' &&
    step.nodes.some((n) => n.id === 'script') &&
    step.nodes.some((n) => n.id === 'pre-shoot')
  );
}
