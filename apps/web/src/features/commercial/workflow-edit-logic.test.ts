import { describe, expect, test } from 'bun:test';
import { createProjectWorkflow } from './workflow-graph-canonical';
import { advanceWorkflowNode, blockWorkflowNode } from './workflow-edit-logic';

describe('workflow edit logic', () => {
  test('advance respects predecessor completion', () => {
    const graph = createProjectWorkflow({
      inq: { status: 'done' },
      outline: { status: 'in_progress' },
    });
    const result = advanceWorkflowNode(graph, 'script');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('大纲');
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
