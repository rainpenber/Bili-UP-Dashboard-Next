import { describe, expect, test } from 'bun:test';
import {
  WF_NODE_KINDS,
  parseCommercialDefaultTemplate,
  parseCommercialProjectArchiveResponse,
  parseCommercialProjectDetail,
  parseCommercialProjectList,
  parseCommercialProjectWorkflow,
} from './commercial';

const PROJECT_ID = 'f0010001-0001-4001-8001-000000000004';
const NODE_A = 'dddddddd-dddd-4ddd-8ddd-ddddddddd003';
const NODE_B = 'dddddddd-dddd-4ddd-8ddd-ddddddddd014';
const EDGE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04';
const ITEM_ID = 'f0a10001-0001-4001-8001-0000000000a4';

const READ_FIELDS = {
  phase: 'pending' as const,
  createdAt: '2026-05-01T00:00:00.000000Z',
  updatedAt: '2026-05-01T00:00:00.000000Z',
  userDeadlineAt: null,
  blockedSinceAt: null,
  archivedAt: null,
  stageEnteredAt: '2026-05-01T00:00:00.000000Z',
  businessClosedAt: null,
  originKind: 'fixture' as const,
  source: null as null,
  businessState: null as null,
  originStatusLabel: null as null,
  sourceWindow: null as null,
  blockedNodeNames: [] as string[],
  openItems: [] as unknown[],
  blockingReason: null as string | null,
};

function listItem(overrides: Record<string, unknown>) {
  return { ...READ_FIELDS, ...overrides };
}

function listResponse(items: unknown[]) {
  return { items, total: items.length, limit: null, offset: 0 };
}

describe('commercial read contracts', () => {
  test('node kinds are only stage and merge', () => {
    expect([...WF_NODE_KINDS]).toEqual(['stage', 'merge']);
  });

  test('parses a project list item', () => {
    const parsed = parseCommercialProjectList(
      listResponse([
        listItem({
          id: PROJECT_ID,
          name: '甲方卡文案确认样例',
          netAmount: '18000.00',
          rebateAmount: '600.00',
          overallStage: 'pre_publish',
          currentStageNames: ['文案', '预拍摄'],
          anyNodeBlocked: true,
          blockingReason: '甲方文案批注未清',
          userDeadlineAt: '2026-08-01T00:00:00.000000Z',
          blockedNodeNames: ['文案'],
          openItems: [
            {
              id: ITEM_ID,
              title: '甲方文案批注未清',
              description: null,
              closeCriteria: null,
              nextAction: null,
              nextActor: 'client',
              lifecycle: 'open',
              impact: 'blocking',
              plannedAt: null,
              sortRank: 0,
              blocksRequiredForClose: false,
              workflowNodeId: NODE_A,
              blocksNodeId: NODE_A,
              createdAt: '2026-05-02T00:00:00.000000Z',
              updatedAt: '2026-05-02T00:00:00.000000Z',
            },
          ],
        }),
      ]),
    );
    expect(parsed.items[0]?.netAmount).toBe('18000.00');
    expect(parsed.items[0]?.phase).toBe('pending');
    expect(parsed.items[0]?.currentStageNames).toEqual(['文案', '预拍摄']);
    expect(parsed.items[0]?.openItems[0]?.plannedAt).toBeNull();
    expect(parsed.items[0]?.openItems[0]?.nextActor).toBe('client');
    expect(parsed.items[0]?.userDeadlineAt).toBe('2026-08-01T00:00:00.000000Z');
    expect(parsed.items[0]?.originKind).toBe('fixture');
    expect(parsed.items[0]?.businessState).toBeNull();
    expect(parsed.items[0]?.originStatusLabel).toBeNull();
    expect(parsed.items[0]?.sourceWindow).toBeNull();
    expect(parsed.total).toBe(1);
    expect(parsed.limit).toBeNull();
    expect(parsed.offset).toBe(0);
  });

  test('parses source-bound display state fields without inventing labels', () => {
    const parsed = parseCommercialProjectList(
      listResponse([
        listItem({
          id: PROJECT_ID,
          name: '树新风',
          netAmount: null,
          rebateAmount: null,
          overallStage: 'pre_publish',
          currentStageNames: [],
          anyNodeBlocked: false,
          originKind: 'real',
          source: {
            namespace: 'hermes.real',
            sourceId: 'sx-1',
            sourceUpdatedAt: '2026-10-01T00:00:00.000Z',
            importedAt: '2026-10-01T00:00:00.000Z',
            contentHash: 'abc',
            sourceStatus: '2.进行中',
            sourceNotes: null,
          },
          businessState: 'active',
          originStatusLabel: '2.进行中',
          sourceWindow: {
            startAt: '2025-09-17T16:00:00.000Z',
            endAt: '2025-10-20T16:00:00.000Z',
            reminderAt: null,
          },
        }),
      ]),
    );
    expect(parsed.items[0]?.businessState).toBe('active');
    expect(parsed.items[0]?.originStatusLabel).toBe('2.进行中');
    expect(parsed.items[0]?.sourceWindow).toEqual({
      startAt: '2025-09-17T16:00:00.000Z',
      endAt: '2025-10-20T16:00:00.000Z',
      reminderAt: null,
    });
  });

  test('parses a bound-but-empty sourceWindow without inventing dates', () => {
    const parsed = parseCommercialProjectList(
      listResponse([
        listItem({
          id: PROJECT_ID,
          name: '无档期真实单',
          netAmount: null,
          rebateAmount: null,
          overallStage: 'pre_publish',
          currentStageNames: [],
          anyNodeBlocked: false,
          originKind: 'real',
          source: {
            namespace: 'hermes.real',
            sourceId: 'no-window-1',
            sourceUpdatedAt: '2026-10-01T00:00:00.000Z',
            importedAt: '2026-10-01T00:00:00.000Z',
            contentHash: 'def',
            sourceStatus: '2.进行中',
            sourceNotes: null,
          },
          businessState: 'active',
          originStatusLabel: '2.进行中',
          sourceWindow: { startAt: null, endAt: null, reminderAt: null },
        }),
      ]),
    );
    expect(parsed.items[0]?.sourceWindow).toEqual({
      startAt: null,
      endAt: null,
      reminderAt: null,
    });
  });

  test('rejects a malformed sourceWindow', () => {
    expect(() =>
      parseCommercialProjectList(
        listResponse([
          listItem({
            id: PROJECT_ID,
            name: '坏档期',
            netAmount: null,
            rebateAmount: null,
            overallStage: 'pre_publish',
            currentStageNames: [],
            anyNodeBlocked: false,
            sourceWindow: { startAt: 'not-iso', endAt: null, reminderAt: null },
          }),
        ]),
      ),
    ).toThrow(/sourceWindow\.startAt/);
  });

  test('parses archive and unarchive responses', () => {
    expect(
      parseCommercialProjectArchiveResponse({
        id: PROJECT_ID,
        archivedAt: '2026-10-23T00:00:00.000Z',
      }),
    ).toEqual({
      id: PROJECT_ID,
      archivedAt: '2026-10-23T00:00:00.000Z',
    });
    expect(parseCommercialProjectArchiveResponse({ id: PROJECT_ID, archivedAt: null })).toEqual({
      id: PROJECT_ID,
      archivedAt: null,
    });
    expect(() =>
      parseCommercialProjectArchiveResponse({ id: PROJECT_ID, archivedAt: 'not-a-date' }),
    ).toThrow(/archivedAt/);
  });

  test('rejects a list item that omits open items or a stored timestamp', () => {
    const base = listItem({
      id: PROJECT_ID,
      name: '样例',
      netAmount: null,
      rebateAmount: null,
      overallStage: 'pre_publish',
      currentStageNames: [],
      anyNodeBlocked: false,
    });
    const withoutItems = { ...base } as Record<string, unknown>;
    delete withoutItems.openItems;
    expect(() => parseCommercialProjectList(listResponse([withoutItems]))).toThrow(/openItems/);
    const withoutCreated = { ...base } as Record<string, unknown>;
    delete withoutCreated.createdAt;
    expect(() => parseCommercialProjectList(listResponse([withoutCreated]))).toThrow(/createdAt/);
    expect(() =>
      parseCommercialProjectList(listResponse([listItem({ ...base, phase: 'published' })])),
    ).toThrow(/phase/);
    expect(() =>
      parseCommercialProjectList(
        listResponse([listItem({ ...base, openItems: [{ id: ITEM_ID }] })]),
      ),
    ).toThrow(/nextActor|title|open item/);
  });

  test('rejects a numeric amount and an unknown node kind', () => {
    expect(() =>
      parseCommercialProjectList(
        listResponse([
          listItem({
            id: PROJECT_ID,
            name: '样例',
            netAmount: 18000,
            rebateAmount: null,
            overallStage: 'pre_publish',
            currentStageNames: [],
            anyNodeBlocked: false,
          }),
        ]),
      ),
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
            plannedAt: null,
            completedAt: null,
            posX: 0,
            posY: 0,
            updatedAt: '2026-05-20T12:00:00.000000Z',
          },
        ],
        edges: [],
      }),
    ).toThrow(/kind/);
  });

  test('parses detail publish status and a merge node', () => {
    const detail = parseCommercialProjectDetail(
      listItem({
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
          platform: 'bilibili',
          bvid: 'BVWP004R01',
          publishedAt: '2026-05-20T12:00:00.000Z',
          publishSource: 'web',
          idempotencyKey: 'fixture-publish-once',
          contentKind: 'video',
          contentUrl: null,
          externalId: null,
        },
      }),
    );
    expect(detail.publish.published).toBe(true);
    expect(detail.publish.idempotencyKey).toBe('fixture-publish-once');
    expect(detail.publish.contentKind).toBe('video');
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
          plannedAt: '2026-04-02T16:00:00.000Z',
          completedAt: null,
          posX: 0,
          posY: 0,
          updatedAt: '2026-05-20T12:00:00.000000Z',
        },
        {
          id: NODE_B,
          name: '汇合节点',
          status: 'not_reached',
          kind: 'merge',
          templateSlug: 'merge',
          blockingReason: null,
          plannedAt: null,
          completedAt: null,
          posX: 0,
          posY: 0,
          updatedAt: '2026-05-20T12:00:00.100000Z',
        },
      ],
      edges: [{ id: EDGE_ID, fromNodeId: NODE_A, toNodeId: NODE_B }],
    });
    expect(graph.nodes.find((node) => node.name === '汇合节点')?.kind).toBe('merge');
    expect(graph.nodes.find((node) => node.templateSlug === 'copy')?.blockingReason).toBe(
      '甲方文案批注未清',
    );
    expect(graph.nodes.find((node) => node.templateSlug === 'copy')?.plannedAt).toBe(
      '2026-04-02T16:00:00.000Z',
    );
    expect(graph.nodes.find((node) => node.templateSlug === 'copy')?.completedAt).toBeNull();
    expect(() =>
      parseCommercialProjectWorkflow({
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
            blockingReason: null,
            posX: 0,
            posY: 0,
            updatedAt: '2026-05-20T12:00:00.000000Z',
          },
        ],
        edges: [],
      }),
    ).toThrow(/plannedAt/);
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

  test('parses a published post record without a bvid', () => {
    const detail = parseCommercialProjectDetail(
      listItem({
        id: PROJECT_ID,
        name: 'AI眼镜新品-品牌待确认',
        netAmount: null,
        rebateAmount: null,
        overallStage: 'published_winding_down',
        currentStageNames: [],
        anyNodeBlocked: false,
        blockingReason: null,
        publish: {
          published: true,
          platform: 'bilibili',
          bvid: null,
          publishedAt: '2026-10-24T00:00:00.000Z',
          publishSource: 'web',
          idempotencyKey: 'fixture-publish-post',
          contentKind: 'post',
          contentUrl: 'https://t.bilibili.com/1262617308018245635',
          externalId: '1262617308018245635',
        },
      }),
    );
    expect(detail.publish).toMatchObject({
      published: true,
      platform: 'bilibili',
      bvid: null,
      contentKind: 'post',
      externalId: '1262617308018245635',
    });
  });

  test('rejects a published record with neither bvid nor external id', () => {
    expect(() =>
      parseCommercialProjectDetail(
        listItem({
          id: PROJECT_ID,
          name: '缺少内容标识',
          netAmount: null,
          rebateAmount: null,
          overallStage: 'published_winding_down',
          currentStageNames: [],
          anyNodeBlocked: false,
          blockingReason: null,
          publish: {
            published: true,
            platform: 'bilibili',
            bvid: null,
            publishedAt: '2026-10-24T00:00:00.000Z',
            publishSource: 'web',
            idempotencyKey: 'fixture-publish-missing-id',
            contentKind: 'post',
            contentUrl: null,
            externalId: null,
          },
        }),
      ),
    ).toThrow('已发布的记录必须有 bvid 或外部内容 ID');
  });

  test('still requires a bvid for a published video record', () => {
    expect(() =>
      parseCommercialProjectDetail(
        listItem({
          id: PROJECT_ID,
          name: '视频缺少 bvid',
          netAmount: null,
          rebateAmount: null,
          overallStage: 'published_winding_down',
          currentStageNames: [],
          anyNodeBlocked: false,
          blockingReason: null,
          publish: {
            published: true,
            platform: 'bilibili',
            bvid: null,
            publishedAt: '2026-10-24T00:00:00.000Z',
            publishSource: 'web',
            idempotencyKey: 'fixture-publish-video-missing-bvid',
            contentKind: 'video',
            contentUrl: null,
            externalId: '1262617308018245635',
          },
        }),
      ),
    ).toThrow(/publish\.bvid/);
  });

  test('rejects an unpublished payload that still carries a bvid', () => {
    expect(() =>
      parseCommercialProjectDetail(
        listItem({
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
      ),
    ).toThrow(/unpublished/);
  });
});
