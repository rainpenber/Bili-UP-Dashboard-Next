import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphStep } from './types';

function baseNode(id: string, name: string): WorkflowGraphNode {
  return { id, name, status: 'not_reached' };
}

export type WorkflowShape = {
  productionNodes?: WorkflowGraphNode[];
  serialAfterPrep?: WorkflowGraphNode[];
  serialBeforePublish?: WorkflowGraphNode[];
  postPublishNodes?: WorkflowGraphNode[];
  serialAfterPostPublish?: WorkflowGraphNode[];
};

function cloneNode(node: WorkflowGraphNode): WorkflowGraphNode {
  return { ...node };
}

function applyPatch(
  node: WorkflowGraphNode,
  patch?: Partial<WorkflowGraphNode>,
): WorkflowGraphNode {
  if (!patch) return node;
  return { ...node, ...patch, id: node.id, name: patch.name ?? node.name };
}

function buildBaseSteps(shape?: WorkflowShape): WorkflowGraphStep[] {
  const prep: WorkflowGraphStep = {
    kind: 'parallel',
    nodes: [baseNode('script', '文案'), baseNode('pre-shoot', '预拍摄')],
  };
  const productionNodes = shape?.productionNodes ?? [
    baseNode('ar', 'A-roll 拍摄'),
    baseNode('br', 'B-roll 素材'),
    baseNode('ai', 'AI 后期'),
  ];
  const prod: WorkflowGraphStep = { kind: 'parallel', nodes: productionNodes.map(cloneNode) };
  const postPublishNodes = shape?.postPublishNodes ?? [
    baseNode('settle', '结算'),
    baseNode('distribute', '全平台分发'),
    baseNode('data-care', '数据维护'),
    baseNode('other', '其他'),
  ];

  const steps: WorkflowGraphStep[] = [
    { kind: 'serial', node: baseNode('inq', '询单') },
    { kind: 'serial', node: baseNode('outline', '大纲') },
    prep,
  ];

  if (shape?.serialAfterPrep) {
    for (const extra of shape.serialAfterPrep) {
      steps.push({ kind: 'serial', node: cloneNode(extra) });
    }
  }

  steps.push(prod);
  steps.push({ kind: 'serial', node: baseNode('rev', '审核') });

  if (shape?.serialBeforePublish) {
    for (const extra of shape.serialBeforePublish) {
      steps.push({ kind: 'serial', node: cloneNode(extra) });
    }
  }

  steps.push({ kind: 'serial', node: baseNode('pub', '发布') });
  steps.push({ kind: 'parallel', nodes: postPublishNodes.map(cloneNode) });

  if (shape?.serialAfterPostPublish) {
    for (const extra of shape.serialAfterPostPublish) {
      steps.push({ kind: 'serial', node: cloneNode(extra) });
    }
  }

  return steps;
}

/** 生成含发布后收尾节点的完整商单流程（未写明的节点保持灰色「未到」） */
export function createProjectWorkflow(
  patches: Record<string, Partial<WorkflowGraphNode>> = {},
  shape?: WorkflowShape,
): WorkflowGraph {
  const steps = buildBaseSteps(shape).map((step) => {
    if (step.kind === 'serial') {
      return {
        kind: 'serial' as const,
        node: applyPatch(step.node, patches[step.node.id]),
      };
    }
    return {
      kind: 'parallel' as const,
      nodes: step.nodes.map((n) => applyPatch(n, patches[n.id])),
    };
  });
  return { steps };
}

export function defaultTemplateWorkflow(): WorkflowGraph {
  return createProjectWorkflow();
}
