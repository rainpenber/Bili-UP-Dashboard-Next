import { describe, expect, test } from 'bun:test';
import { createProjectWorkflow } from './workflow-graph-canonical';
import { attemptWorkflowTransition, blockWorkflowNode } from './workflow-edit-logic';

describe('workflow edit logic', () => {
  test('start transition prompts when predecessors are not done', () => {
    const graph = createProjectWorkflow({
      inq: { status: 'done' },
      outline: { status: 'in_progress' },
    });
    const result = attemptWorkflowTransition(graph, 'script', 'start');
    expect(result.status).toBe('needs_predecessors');
    if (result.status === 'needs_predecessors') {
      expect(result.blockers.some((n) => n.name.includes('大纲'))).toBe(true);
    }
  });

  test('block requires non-empty reason', () => {
    const graph = createProjectWorkflow({ outline: { status: 'in_progress' } });
    expect(blockWorkflowNode(graph, 'outline', '   ').ok).toBe(false);
    const ok = blockWorkflowNode(graph, 'outline', '等甲方定稿');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(
        ok.graph.steps.find((s) => s.kind === 'serial' && s.node.id === 'outline')?.node.status,
      ).toBe('blocked');
    }
  });
});
