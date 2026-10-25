import { describe, expect, test } from 'bun:test';
import {
  COMMERCIAL_WORKFLOW_NODE_NAME_MAX,
  parseCommercialBlockRequest,
  parseCommercialNodeStepRequest,
  parseCommercialStageStepRequest,
  parseCommercialCancelItemRequest,
  parseCommercialNodeWriteResponse,
  parseCommercialOpenItemCreateRequest,
  parseCommercialOpenItemSnapshot,
  parseCommercialOpenItemUpdateRequest,
  parseCommercialPlanRequest,
  parseCommercialPublishRequest,
  parseCommercialPublishResponse,
  parseCommercialWorkflowLayoutRequest,
  parseCommercialWorkflowLayoutResponse,
  parseCommercialWriteError,
} from './commercial-write';

const PROJECT_ID = 'f0010001-0001-4001-8001-000000000004';
const NODE_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd003';
const ITEM_ID = 'f0a10001-0001-4001-8001-0000000000a4';
const STAMP = '2026-10-15T12:00:00.123456Z';

function snapshot() {
  return {
    id: NODE_ID,
    name: '文案',
    status: 'blocked',
    kind: 'stage',
    updatedAt: STAMP,
    statusBeforeBlock: 'in_progress',
    primaryBlockItemId: ITEM_ID,
    plannedAt: null,
    completedAt: null,
  };
}

describe('commercial write contracts', () => {
  test('parses a node write and rejects a blank blocking reason', () => {
    const parsed = parseCommercialNodeWriteResponse({
      projectId: PROJECT_ID,
      node: snapshot(),
      blockingReason: '等甲方',
      pinnedItem: {
        id: ITEM_ID,
        title: '等甲方',
        lifecycle: 'open',
        impact: 'blocking',
        updatedAt: STAMP,
      },
    });
    expect(parsed.blockingReason).toBe('等甲方');
    expect(parsed.node.statusBeforeBlock).toBe('in_progress');

    expect(() =>
      parseCommercialNodeWriteResponse({
        projectId: PROJECT_ID,
        node: { ...snapshot(), primaryBlockItemId: null, status: 'blocked' },
        blockingReason: '',
        pinnedItem: null,
      }),
    ).toThrow(/blockingReason/);

    expect(() =>
      parseCommercialNodeWriteResponse({
        projectId: PROJECT_ID,
        node: { ...snapshot(), primaryBlockItemId: null },
        blockingReason: ' \n ',
        pinnedItem: null,
      }),
    ).toThrow(/blockingReason/);
  });

  test('plan request accepts a calendar date or null and rejects a timestamp', () => {
    expect(
      parseCommercialPlanRequest({ expectedUpdatedAt: STAMP, plannedAt: '2026-04-02' }),
    ).toEqual({ expectedUpdatedAt: STAMP, plannedAt: '2026-04-02' });
    expect(parseCommercialPlanRequest({ expectedUpdatedAt: STAMP, plannedAt: null })).toEqual({
      expectedUpdatedAt: STAMP,
      plannedAt: null,
    });
    expect(() =>
      parseCommercialPlanRequest({ expectedUpdatedAt: STAMP, plannedAt: '2026-04-02T00:00:00Z' }),
    ).toThrow(/plannedAt/);
    expect(() =>
      parseCommercialPlanRequest({ expectedUpdatedAt: STAMP, plannedAt: '2026-02-31' }),
    ).toThrow(/calendar date/);
  });

  test('block request keeps an empty reason so the handler can drop it', () => {
    expect(parseCommercialBlockRequest({ expectedUpdatedAt: STAMP, reason: ' \n ' })).toEqual({
      expectedUpdatedAt: STAMP,
      reason: ' \n ',
    });
    expect(parseCommercialBlockRequest({ expectedUpdatedAt: STAMP })).toEqual({
      expectedUpdatedAt: STAMP,
    });
  });

  test('cancel request allows a blank reason for the database check', () => {
    expect(
      parseCommercialCancelItemRequest({ expectedUpdatedAt: STAMP, cancelReason: '   ' }),
    ).toEqual({ expectedUpdatedAt: STAMP, cancelReason: '   ' });
  });

  test('publish request accepts a URL without a separate bvid', () => {
    const parsed = parseCommercialPublishRequest({
      expectedUpdatedAt: STAMP,
      idempotencyKey: 'pub-1',
      platform: 'bilibili',
      videoUrl: 'https://www.bilibili.com/video/BV1example',
    });
    expect(parsed.videoUrl).toBe('https://www.bilibili.com/video/BV1example');
    expect(parsed.bvid).toBeUndefined();
    expect(() =>
      parseCommercialPublishRequest({
        expectedUpdatedAt: STAMP,
        idempotencyKey: 'pub-1',
        platform: 'bilibili',
      }),
    ).toThrow(/bvid or videoUrl/);
  });

  test('post publish request derives externalId and requires contentUrl', () => {
    const parsed = parseCommercialPublishRequest({
      expectedUpdatedAt: STAMP,
      idempotencyKey: 'post-1',
      platform: 'bilibili',
      contentKind: 'post',
      contentUrl: 'https://t.bilibili.com/1262617308018245635',
    });
    expect(parsed.contentKind).toBe('post');
    expect(parsed.contentUrl).toBe('https://t.bilibili.com/1262617308018245635');
    expect(parsed.externalId).toBe('1262617308018245635');
    expect(parsed.bvid).toBeUndefined();
    expect(
      parseCommercialPublishRequest({
        expectedUpdatedAt: STAMP,
        idempotencyKey: 'post-2',
        platform: 'xiaohongshu',
        contentKind: 'post',
        contentUrl: 'https://www.xiaohongshu.com/explore/abc123def456',
        externalId: 'explicit-id',
      }).externalId,
    ).toBe('explicit-id');
    expect(() =>
      parseCommercialPublishRequest({
        expectedUpdatedAt: STAMP,
        idempotencyKey: 'post-3',
        platform: 'bilibili',
        contentKind: 'post',
      }),
    ).toThrow(/contentUrl/);
  });

  test('a step request keeps force and publish optional', () => {
    const node = parseCommercialNodeStepRequest({
      expectedUpdatedAt: STAMP,
      direction: 'forward',
    });
    expect(node.force).toBe(false);
    expect(node.publish).toBeNull();
    const stage = parseCommercialStageStepRequest({
      direction: 'rollback',
      tokens: [{ nodeId: NODE_ID, expectedUpdatedAt: STAMP }],
      force: true,
    });
    expect(stage.force).toBe(true);
    expect(stage.tokens).toEqual([{ nodeId: NODE_ID, expectedUpdatedAt: STAMP }]);
  });

  test('confirmation errors keep the blocks and the planned effects', () => {
    const parsed = parseCommercialWriteError({
      error: '有开放阻塞，确认后才会强制推进并标记前置完成',
      code: 'confirmation_required',
      names: ['文案'],
      blocks: [{ nodeId: NODE_ID, nodeName: '文案', reason: '等甲方', itemId: ITEM_ID }],
      effects: [{ nodeId: NODE_ID, nodeName: '文案', from: 'blocked', to: 'in_progress' }],
    });
    expect(parsed.blocks?.[0]?.reason).toBe('等甲方');
    expect(parsed.effects?.[0]?.to).toBe('in_progress');
  });

  test('error body carries the code and the offending names', () => {
    const parsed = parseCommercialWriteError({
      error: '须先完成前置节点：文案、预拍摄',
      code: 'predecessors_incomplete',
      names: ['文案', '预拍摄'],
    });
    expect(parsed.code).toBe('predecessors_incomplete');
    expect(parsed.names).toEqual(['文案', '预拍摄']);
    expect(() => parseCommercialWriteError({ error: 'x', code: 'nope' })).toThrow(/code/);
  });

  test('publish response requires the monitor jobs', () => {
    const parsed = parseCommercialPublishResponse({
      projectId: PROJECT_ID,
      node: {
        ...snapshot(),
        name: '发布',
        status: 'completed',
        statusBeforeBlock: null,
        primaryBlockItemId: null,
        completedAt: STAMP,
      },
      publish: {
        bvid: 'BV1example',
        publishedAt: STAMP,
        publishSource: 'web',
        idempotencyKey: 'pub-1',
        platform: 'bilibili',
        videoUrl: null,
      },
      monitor: {
        contractId: 'f0a00001-0001-4001-8001-000000000003',
        bvid: 'BV1example',
        metadataTaskStatus: 'pending',
        jobs: [
          { id: 'f0c00001-0001-4001-8001-000000000001', jobType: 'metadata', status: 'pending' },
          { id: 'f0c00001-0001-4001-8001-000000000002', jobType: 'metrics', status: 'pending' },
        ],
      },
      idempotentReplay: false,
    });
    if (!parsed.monitor) throw new Error('missing monitor');
    expect(parsed.monitor.jobs.map((job) => job.jobType)).toEqual(['metadata', 'metrics']);
    expect(parsed.idempotentReplay).toBe(false);
  });

  test('post publish response carries no bvid and no monitor contract', () => {
    const parsed = parseCommercialPublishResponse({
      projectId: PROJECT_ID,
      node: {
        ...snapshot(),
        name: '发布',
        status: 'completed',
        statusBeforeBlock: null,
        primaryBlockItemId: null,
        completedAt: STAMP,
      },
      publish: {
        bvid: null,
        publishedAt: STAMP,
        publishSource: 'web',
        idempotencyKey: 'post-1',
        platform: 'bilibili',
        videoUrl: null,
        contentKind: 'post',
        contentUrl: 'https://t.bilibili.com/1262617308018245635',
        externalId: '1262617308018245635',
      },
      monitor: null,
      idempotentReplay: false,
    });
    expect(parsed.publish.contentKind).toBe('post');
    expect(parsed.publish.bvid).toBeNull();
    expect(parsed.publish.externalId).toBe('1262617308018245635');
    expect(parsed.monitor).toBeNull();
  });

  test('open item create accepts three actors and validates title, note, and dueAt', () => {
    const created = parseCommercialOpenItemCreateRequest({
      title: '  甲方未寄样品  ',
      nextActor: 'third_party',
      impact: 'blocking',
      dueAt: '2026-11-01T00:00:00.000Z',
      note: '  等样机  ',
    });
    expect(created).toEqual({
      title: '甲方未寄样品',
      nextActor: 'third_party',
      impact: 'blocking',
      dueAt: '2026-11-01T00:00:00.000Z',
      note: '等样机',
    });
    expect(
      parseCommercialOpenItemCreateRequest({
        title: '无截止',
        nextActor: 'us',
        impact: 'normal',
      }),
    ).toEqual({ title: '无截止', nextActor: 'us', impact: 'normal', dueAt: null, note: null });
    expect(() =>
      parseCommercialOpenItemCreateRequest({
        title: '   ',
        nextActor: 'us',
        impact: 'normal',
      }),
    ).toThrow(/title/);
    expect(() =>
      parseCommercialOpenItemCreateRequest({
        title: 'x'.repeat(201),
        nextActor: 'us',
        impact: 'normal',
      }),
    ).toThrow(/at most/);
    expect(() =>
      parseCommercialOpenItemCreateRequest({
        title: '非法责任方',
        nextActor: 'vendor',
        impact: 'normal',
      }),
    ).toThrow(/nextActor/);
    expect(() =>
      parseCommercialOpenItemCreateRequest({
        title: '非法影响',
        nextActor: 'us',
        impact: 'warning',
      }),
    ).toThrow(/impact/);
    expect(() =>
      parseCommercialOpenItemCreateRequest({
        title: '坏日期',
        nextActor: 'us',
        impact: 'normal',
        dueAt: 'tomorrow',
      }),
    ).toThrow(/dueAt/);
    expect(() =>
      parseCommercialOpenItemCreateRequest({
        title: '长说明',
        nextActor: 'us',
        impact: 'normal',
        note: 'x'.repeat(501),
      }),
    ).toThrow(/at most/);
  });

  test('open item update keeps omitted fields absent and rejects an invalid actor', () => {
    const patch = parseCommercialOpenItemUpdateRequest({
      expectedUpdatedAt: STAMP,
      title: ' 新标题 ',
      nextActor: 'client',
      dueAt: null,
    });
    expect(patch).toEqual({
      expectedUpdatedAt: STAMP,
      title: '新标题',
      nextActor: 'client',
      dueAt: null,
    });
    expect(parseCommercialOpenItemUpdateRequest({ expectedUpdatedAt: STAMP, note: '   ' })).toEqual(
      { expectedUpdatedAt: STAMP, note: null },
    );
    expect(() =>
      parseCommercialOpenItemUpdateRequest({
        expectedUpdatedAt: STAMP,
        nextActor: 'vendor',
      }),
    ).toThrow(/nextActor/);
  });

  test('open item write snapshot carries actor, dueAt, and note', () => {
    const parsed = parseCommercialOpenItemSnapshot({
      id: ITEM_ID,
      title: '甲方未寄样品',
      lifecycle: 'open',
      impact: 'blocking',
      nextActor: 'third_party',
      dueAt: '2026-11-01T00:00:00.000Z',
      note: '等样机',
      updatedAt: STAMP,
      cancelReason: null,
    });
    expect(parsed.nextActor).toBe('third_party');
    expect(parsed.dueAt).toBe('2026-11-01T00:00:00.000Z');
    expect(parsed.note).toBe('等样机');
    expect(() =>
      parseCommercialOpenItemSnapshot({
        id: ITEM_ID,
        title: '非法责任方',
        lifecycle: 'open',
        impact: 'normal',
        nextActor: 'vendor',
        dueAt: null,
        note: null,
        updatedAt: STAMP,
        cancelReason: null,
      }),
    ).toThrow(/nextActor/);
  });

  test('layout request trims names, caps length, and requires a real change', () => {
    expect(
      parseCommercialWorkflowLayoutRequest({
        nodes: [
          { nodeId: NODE_ID, expectedUpdatedAt: STAMP, name: '  大纲定稿  ' },
          {
            nodeId: 'dddddddd-dddd-4ddd-8ddd-ddddddddd014',
            expectedUpdatedAt: STAMP,
          },
        ],
      }),
    ).toEqual({
      nodes: [
        { nodeId: NODE_ID, expectedUpdatedAt: STAMP, name: '大纲定稿' },
        {
          nodeId: 'dddddddd-dddd-4ddd-8ddd-ddddddddd014',
          expectedUpdatedAt: STAMP,
        },
      ],
    });

    expect(() =>
      parseCommercialWorkflowLayoutRequest({
        nodes: [{ nodeId: NODE_ID, expectedUpdatedAt: STAMP, name: '   ' }],
      }),
    ).toThrow(/name/);
    expect(() =>
      parseCommercialWorkflowLayoutRequest({
        nodes: [
          {
            nodeId: NODE_ID,
            expectedUpdatedAt: STAMP,
            name: 'x'.repeat(COMMERCIAL_WORKFLOW_NODE_NAME_MAX + 1),
          },
        ],
      }),
    ).toThrow(/at most/);
    expect(() =>
      parseCommercialWorkflowLayoutRequest({
        nodes: [{ nodeId: NODE_ID, expectedUpdatedAt: STAMP }],
      }),
    ).toThrow(/at least one/);
    expect(() =>
      parseCommercialWorkflowLayoutRequest({
        nodes: [
          { nodeId: NODE_ID, expectedUpdatedAt: STAMP, posX: 1 },
          { nodeId: NODE_ID, expectedUpdatedAt: STAMP, posY: 2 },
        ],
      }),
    ).toThrow(/same nodeId/);
  });

  test('layout response keeps workflow node fields including coordinates', () => {
    const parsed = parseCommercialWorkflowLayoutResponse({
      projectId: PROJECT_ID,
      updatedAt: STAMP,
      nodes: [
        {
          id: NODE_ID,
          name: '文案',
          status: 'blocked',
          kind: 'stage',
          templateSlug: 'copy',
          blockingReason: '等甲方',
          plannedAt: null,
          completedAt: null,
          posX: 120,
          posY: 40,
          updatedAt: STAMP,
        },
      ],
    });
    expect(parsed.nodes[0]?.posX).toBe(120);
    expect(parsed.nodes[0]?.blockingReason).toBe('等甲方');
  });
});
