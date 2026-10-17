import { describe, expect, test } from 'bun:test';
import { defaultTemplateWorkflow } from './workflow-graph-canonical';
import { collapseRoutingEdges } from './workflow-graph-flow-layout';
import {
  applySessionRename,
  commercialWorkflowToLive,
  workflowGraphToLive,
} from './workflow-live-graph';
import { listWorkflowConnections } from './workflow-structure-logic';
import { toDemoStatus } from './workflow-status-map';

describe('toDemoStatus', () => {
  test('maps persisted and mock statuses onto the four cells', () => {
    expect(toDemoStatus('completed')).toBe('done');
    expect(toDemoStatus('done')).toBe('done');
    expect(toDemoStatus('in_progress')).toBe('active');
    expect(toDemoStatus('blocked')).toBe('blocked');
    expect(toDemoStatus('not_reached')).toBe('idle');
    expect(toDemoStatus('not_applicable')).toBe('idle');
  });
});

describe('workflowGraphToLive', () => {
  test('display junctions collapse back to the declared business edges', () => {
    const graph = defaultTemplateWorkflow();
    const declared = listWorkflowConnections(graph);
    const live = workflowGraphToLive(graph);
    expect(live.nodes.filter((node) => node.kind === 'merge')).toHaveLength(2);
    expect(live.nodes.find((node) => node.id === 'outline')?.status).toBe('not_reached');
    const collapsed = collapseRoutingEdges(
      live.edges.map((edge) => ({ from: edge.source, to: edge.target })),
    );
    expect(new Set(collapsed.map((edge) => `${edge.from}->${edge.to}`))).toEqual(
      new Set(declared.map((edge) => `${edge.from}->${edge.to}`)),
    );
  });
});

describe('commercialWorkflowToLive', () => {
  test('keeps database merge nodes and does not insert display junctions', () => {
    const stageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const mergeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    const edgeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
    const live = commercialWorkflowToLive({
      projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
      workflowId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
      templateVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
      nodes: [
        {
          id: stageId,
          name: '大纲',
          status: 'in_progress',
          kind: 'stage',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: mergeId,
          name: '汇合节点',
          status: 'not_applicable',
          kind: 'merge',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      edges: [{ id: edgeId, fromNodeId: stageId, toNodeId: mergeId }],
    });
    expect(live.nodes).toHaveLength(2);
    expect(live.nodes.filter((node) => node.kind === 'merge').map((node) => node.id)).toEqual([
      mergeId,
    ]);
    expect(live.edges).toEqual([{ id: edgeId, source: stageId, target: mergeId }]);
    expect(toDemoStatus(live.nodes[0]!.status ?? '')).toBe('active');
    expect(toDemoStatus(live.nodes[1]!.status ?? '')).toBe('idle');
  });
});

describe('applySessionRename', () => {
  const nodes = [
    { id: 'a', name: '大纲' },
    { id: 'b', name: '文案' },
  ];

  test('rejects empty and duplicate names', () => {
    expect(applySessionRename(nodes, 'a', '  ').ok).toBe(false);
    const duplicate = applySessionRename(nodes, 'a', '文案');
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.message).toContain('唯一');
    expect(applySessionRename(nodes, 'a', '大纲定稿')).toEqual({ ok: true, name: '大纲定稿' });
  });
});
