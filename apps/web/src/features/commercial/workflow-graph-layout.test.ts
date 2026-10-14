import { describe, expect, test } from 'bun:test';
import { createProjectWorkflow } from './workflow-graph-canonical';
import { defaultWorkflowTemplate } from './mock-data';
import {
  flattenWorkflowGraph,
  hasForkJoinPair,
  includesPostPublishWindDown,
  isPrepParallelStep,
  parallelSiblingCount,
  workflowNodeStatusClass,
} from './workflow-graph-layout';

describe('workflow graph layout', () => {
  test('prep and production are separate parallel rows with side-by-side siblings', () => {
    const rows = flattenWorkflowGraph(defaultWorkflowTemplate.graph);
    const parallelCounts = parallelSiblingCount(rows);
    expect(parallelCounts.length).toBeGreaterThanOrEqual(3);
    expect(parallelCounts[0]).toBe(2);
    expect(parallelCounts[1]).toBe(3);
    expect(parallelCounts[2]).toBe(4);
    expect(hasForkJoinPair(rows)).toBe(true);
  });

  test('prep parallel step contains 文案 and 预拍摄', () => {
    const prep = defaultWorkflowTemplate.graph.steps.find(isPrepParallelStep);
    expect(prep?.kind).toBe('parallel');
    if (prep?.kind === 'parallel') {
      const names = prep.nodes.map((n) => n.name);
      expect(names).toContain('文案');
      expect(names).toContain('预拍摄');
    }
  });

  test('early-stage project still shows post-publish wind-down in grey', () => {
    const graph = createProjectWorkflow({
      outline: { status: 'in_progress' },
    });
    expect(includesPostPublishWindDown(graph)).toBe(true);
    const settle = graph.steps
      .flatMap((s) => (s.kind === 'parallel' ? s.nodes : [s.node]))
      .find((n) => n.id === 'settle');
    expect(settle?.status).toBe('not_reached');
  });

  test('custom outdoor shoot stays in one parallel row', () => {
    const graph = createProjectWorkflow(
      {},
      {
        productionNodes: [
          { id: 'ar', name: 'A-roll 棚拍', status: 'in_progress' },
          { id: 'out', name: '外拍补充镜头', status: 'in_progress' },
          { id: 'br', name: 'B-roll', status: 'not_reached' },
        ],
      },
    );
    const prod = graph.steps.find(
      (s) => s.kind === 'parallel' && s.nodes.some((n) => n.id === 'out'),
    );
    expect(prod?.kind).toBe('parallel');
    if (prod?.kind === 'parallel') {
      expect(prod.nodes).toHaveLength(3);
    }
  });

  test('status classes map done and blocked', () => {
    expect(workflowNodeStatusClass('done')).toContain('success');
    expect(workflowNodeStatusClass('blocked')).toContain('destructive');
  });
});
