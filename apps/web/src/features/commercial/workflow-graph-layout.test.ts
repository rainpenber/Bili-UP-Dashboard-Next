import { describe, expect, test } from 'bun:test';
import { defaultWorkflowTemplate } from './mock-data';
import { flattenWorkflowGraph, workflowNodeStatusClass } from './workflow-graph-layout';

describe('workflow graph layout', () => {
  test('flatten includes parallel group row', () => {
    const rows = flattenWorkflowGraph(defaultWorkflowTemplate.graph);
    const parallel = rows.filter((r) => r.kind === 'parallel');
    expect(parallel.length).toBeGreaterThan(0);
    expect(parallel[0]?.kind === 'parallel' && parallel[0].nodes.length).toBe(3);
  });

  test('status classes map done and blocked', () => {
    expect(workflowNodeStatusClass('done')).toContain('success');
    expect(workflowNodeStatusClass('blocked')).toContain('destructive');
  });
});
