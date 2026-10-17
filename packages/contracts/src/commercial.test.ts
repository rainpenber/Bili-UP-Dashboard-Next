import { describe, expect, test } from 'bun:test';
import {
  WF_NODE_KINDS,
  parseCommercialDefaultTemplate,
  parseCommercialProjectDetail,
  parseCommercialProjectList,
  parseCommercialProjectWorkflow,
} from './commercial';

const PROJECT_ID = 'f0010001-0001-4001-8001-000000000004';
const NODE_A = 'dddddddd-dddd-4ddd-8ddd-ddddddddd003';
const NODE_B = 'dddddddd-dddd-4ddd-8ddd-ddddddddd014';
const EDGE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04';

describe('commercial read contracts', () => {
  test('node kinds are only stage and merge', () => {
    expect([...WF_NODE_KINDS]).toEqual(['stage', 'merge']);
  });

  test('parses a project list item', () => {
    const parsed = parseCommercialProjectList({
      items: [
        {
          id: PROJECT_ID,
          name: '甲方卡文案确认样例',
          netAmount: '18000.00',
          rebateAmount: '600.00',
          overallStage: 'pre_publish',
          currentStageNames: ['文案', '预拍摄'],
          anyNodeBlocked: true,
        },
      ],
    });
    expect(parsed.items[0]?.netAmount).toBe('18000.00');
    expect(parsed.items[0]?.currentStageNames).toEqual(['文案', '预拍摄']);
  });

  test('rejects a numeric amount and an unknown node kind', () => {
    expect(() =>
      parseCommercialProjectList({
        items: [
          {
            id: PROJECT_ID,
            name: '样例',
            netAmount: 18000,
            rebateAmount: null,
            overallStage: 'pre_publish',
            currentStageNames: [],
            anyNodeBlocked: false,
          },
        ],
      }),
    ).toThrow(/netAmount/);

    expect(() =>
      parseCommercialProjectWorkflow({
        projectId: PROJECT_ID,
        workflowId: 'a2000001-0001-4001-8001-000000000001',
        templateVersionId: 'ffff1111-1111-4111-8111-111111111111',
        nodes: [
          {
            id: NODE_B,
            name: '汇合节点',
            status: 'not_reached',
            kind: 'fan',
            templateSlug: 'merge',
            blockingReason: null,
            updatedAt: '2026-05-20T12:00:00.000000Z',
          },
        ],
        edges: [],
      }),
    ).toThrow(/kind/);
  });

  test('parses detail publish status and a merge node', () => {
    const detail = parseCommercialProjectDetail({
      id: PROJECT_ID,
      name: '已上线未收尾样例',
      netAmount: '45000.00',
      rebateAmount: '3500.00',
      overallStage: 'published_winding_down',
      currentStageNames: ['结算'],
      anyNodeBlocked: false,
      blockingReason: null,
      publish: {
        published: true,
        bvid: 'BVWP004R01',
        publishedAt: '2026-05-20T12:00:00.000Z',
        publishSource: 'web',
      },
    });
    expect(detail.publish.published).toBe(true);
    expect(detail.blockingReason).toBeNull();

    const graph = parseCommercialProjectWorkflow({
      projectId: PROJECT_ID,
      workflowId: 'a2000001-0001-4001-8001-000000000001',
      templateVersionId: 'ffff1111-1111-4111-8111-111111111111',
      nodes: [
        {
          id: NODE_A,
          name: '文案',
          status: 'blocked',
          kind: 'stage',
          templateSlug: 'copy',
          blockingReason: '甲方文案批注未清',
          updatedAt: '2026-05-20T12:00:00.000000Z',
        },
        {
          id: NODE_B,
          name: '汇合节点',
          status: 'not_reached',
          kind: 'merge',
          templateSlug: 'merge',
          blockingReason: null,
          updatedAt: '2026-05-20T12:00:00.100000Z',
        },
      ],
      edges: [{ id: EDGE_ID, fromNodeId: NODE_A, toNodeId: NODE_B }],
    });
    expect(graph.nodes.find((node) => node.name === '汇合节点')?.kind).toBe('merge');
    expect(graph.nodes.find((node) => node.templateSlug === 'copy')?.blockingReason).toBe(
      '甲方文案批注未清',
    );
  });

  test('parses the default template graph', () => {
    const template = parseCommercialDefaultTemplate({
      id: 'ffff1111-1111-4111-8111-111111111111',
      slug: 'default_sponsorship',
      name: '默认商单流程',
      version: 1,
      publishedAt: '2026-10-15T00:00:00.000Z',
      nodes: [
        {
          id: NODE_B,
          slug: 'merge',
          name: '汇合节点',
          kind: 'merge',
          isOptional: true,
        },
      ],
      edges: [],
    });
    expect(template.nodes[0]?.isOptional).toBe(true);
  });

  test('rejects an unpublished payload that still carries a bvid', () => {
    expect(() =>
      parseCommercialProjectDetail({
        id: PROJECT_ID,
        name: '样例',
        netAmount: null,
        rebateAmount: null,
        overallStage: 'pre_publish',
        currentStageNames: [],
        anyNodeBlocked: false,
        blockingReason: null,
        publish: {
          published: false,
          bvid: 'BV1',
          publishedAt: null,
          publishSource: null,
        },
      }),
    ).toThrow(/unpublished/);
  });
});
