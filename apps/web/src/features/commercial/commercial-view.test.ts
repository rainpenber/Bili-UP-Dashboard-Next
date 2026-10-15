import { describe, expect, test } from 'bun:test';
import { graphFromWorkflow } from './commercial-view';

const WORKFLOW = 'a2000001-0001-4001-8001-000000000001';
const TEMPLATE = 'ffff1111-1111-4111-8111-111111111111';
const LEFT = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001';
const RIGHT = 'dddddddd-dddd-4ddd-8ddd-ddddddddd002';

describe('graphFromWorkflow', () => {
  test('keeps each node row isOptional, including two nodes with the same name', () => {
    const graph = graphFromWorkflow(
      {
        projectId: 'f0010001-0001-4001-8001-000000000009',
        workflowId: WORKFLOW,
        templateVersionId: TEMPLATE,
        nodes: [
          {
            id: LEFT,
            name: '其他',
            status: 'not_reached',
            kind: 'stage',
            isOptional: true,
            updatedAt: '2026-05-20T12:00:00.000000Z',
          },
          {
            id: RIGHT,
            name: '其他',
            status: 'not_reached',
            kind: 'stage',
            isOptional: false,
            updatedAt: '2026-05-20T12:00:00.000001Z',
          },
        ],
        edges: [],
      },
      { blockingReason: null },
    );
    const nodes = graph.steps.flatMap((step) =>
      step.kind === 'serial' ? [step.node] : step.nodes,
    );
    expect(nodes.map((node) => node.isOptional)).toEqual([true, false]);
  });
});
