import { describe, expect, test } from 'bun:test';
import {
  blockingPredecessorNames,
  blockingSuccessorNames,
  derivedMergeStatus,
  normalizeBlockReason,
  predecessorCompletionPlan,
  notApplicableBlockRefusal,
  predecessorRefusalMessage,
  resolvePublishBvid,
  rollbackTargetStatus,
  successorRefusalMessage,
  type EngineEdge,
  type EngineNode,
} from './engine';

function node(
  id: string,
  name: string,
  status: EngineNode['status'],
  kind?: EngineNode['kind'],
): EngineNode {
  return kind ? { id, name, status, kind } : { id, name, status };
}

const copy = '文案';
const preShoot = '预拍摄';
const aRoll = 'A-roll 拍摄';
const bRoll = 'B-roll 素材';
const aiPost = 'AI 后期';

function fanInEdges(): EngineEdge[] {
  return [
    { fromNodeId: 'copy', toNodeId: 'join' },
    { fromNodeId: 'pre', toNodeId: 'join' },
    { fromNodeId: 'join', toNodeId: 'a' },
    { fromNodeId: 'join', toNodeId: 'b' },
    { fromNodeId: 'join', toNodeId: 'ai' },
  ];
}

describe('predecessor rule', () => {
  test('names every direct predecessor that is not completed', () => {
    const nodes = [
      node('copy', copy, 'not_reached'),
      node('pre', preShoot, 'in_progress'),
      node('join', '汇合节点', 'not_reached'),
    ];
    const names = blockingPredecessorNames('join', nodes, fanInEdges());
    expect(names).toEqual([copy, preShoot]);
    expect(predecessorRefusalMessage(names)).toBe('须先完成前置节点：文案、预拍摄');
  });

  test('a completed predecessor drops out of the refusal', () => {
    const nodes = [
      node('copy', copy, 'completed'),
      node('pre', preShoot, 'blocked'),
      node('join', '汇合节点', 'not_reached'),
    ];
    expect(blockingPredecessorNames('join', nodes, fanInEdges())).toEqual([preShoot]);
  });

  test('both predecessors completed allows in_progress', () => {
    const nodes = [
      node('copy', copy, 'completed'),
      node('pre', preShoot, 'completed'),
      node('join', '汇合节点', 'not_reached'),
    ];
    expect(blockingPredecessorNames('join', nodes, fanInEdges())).toEqual([]);
  });

  test('the same edges block a stage node and a join node identically', () => {
    const edges: EngineEdge[] = [
      { fromNodeId: 'left', toNodeId: 'gate' },
      { fromNodeId: 'right', toNodeId: 'gate' },
    ];
    const asStage = [
      node('left', copy, 'not_reached'),
      node('right', preShoot, 'not_reached'),
      node('gate', '普通节点', 'not_reached'),
    ];
    const asJoin = [
      node('left', copy, 'not_reached'),
      node('right', preShoot, 'not_reached'),
      node('gate', '汇合节点', 'not_reached'),
    ];
    expect(blockingPredecessorNames('gate', asStage, edges)).toEqual(
      blockingPredecessorNames('gate', asJoin, edges),
    );
  });
});

describe('skip passthrough', () => {
  test('a skipped node is replaced by its own predecessors', () => {
    const nodes = [
      node('copy', copy, 'completed'),
      node('pre', preShoot, 'not_reached'),
      node('join', '汇合节点', 'not_applicable'),
      node('a', aRoll, 'not_reached'),
    ];
    expect(blockingPredecessorNames('a', nodes, fanInEdges())).toEqual([preShoot]);
    expect(blockingPredecessorNames('a', nodes, fanInEdges())).not.toContain('汇合节点');
  });

  test('a skipped node with satisfied upstream does not block its successor', () => {
    const nodes = [
      node('copy', copy, 'completed'),
      node('pre', preShoot, 'completed'),
      node('join', '汇合节点', 'not_applicable'),
      node('a', aRoll, 'not_reached'),
      node('b', bRoll, 'not_reached'),
      node('ai', aiPost, 'not_reached'),
    ];
    expect(blockingPredecessorNames('a', nodes, fanInEdges())).toEqual([]);
    expect(blockingPredecessorNames('b', nodes, fanInEdges())).toEqual([]);
    expect(blockingPredecessorNames('ai', nodes, fanInEdges())).toEqual([]);
  });

  test('passthrough is recursive and does not short-circuit', () => {
    const nodes = [
      node('root', '询单', 'in_progress'),
      node('mid', '可选中段', 'not_applicable'),
      node('tail', '可选末段', 'not_applicable'),
      node('next', '下游', 'not_reached'),
    ];
    const edges: EngineEdge[] = [
      { fromNodeId: 'root', toNodeId: 'mid' },
      { fromNodeId: 'mid', toNodeId: 'tail' },
      { fromNodeId: 'tail', toNodeId: 'next' },
    ];
    const names = blockingPredecessorNames('next', nodes, edges);
    expect(names).toEqual(['询单']);
    expect(predecessorRefusalMessage(names)).toBe('须先完成前置节点：询单');
  });

  test('a skipped node with no predecessors does not block', () => {
    const nodes = [node('opt', '其他', 'not_applicable'), node('next', '下游', 'not_reached')];
    const edges: EngineEdge[] = [{ fromNodeId: 'opt', toNodeId: 'next' }];
    expect(blockingPredecessorNames('next', nodes, edges)).toEqual([]);
  });

  test('a cycle of skipped nodes terminates without a name', () => {
    const nodes = [
      node('a', '甲', 'not_applicable'),
      node('b', '乙', 'not_applicable'),
      node('c', '丙', 'not_reached'),
    ];
    const edges: EngineEdge[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'b', toNodeId: 'a' },
      { fromNodeId: 'a', toNodeId: 'c' },
    ];
    expect(blockingPredecessorNames('c', nodes, edges)).toEqual([]);
  });

  test('diamond passthrough names each blocker once, in first-seen order', () => {
    const nodes = [
      node('a', '甲', 'not_reached'),
      node('b', '乙', 'not_applicable'),
      node('c', '丙', 'blocked'),
      node('d', '丁', 'not_reached'),
    ];
    const edges: EngineEdge[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'a', toNodeId: 'c' },
      { fromNodeId: 'b', toNodeId: 'd' },
      { fromNodeId: 'c', toNodeId: 'd' },
    ];
    expect(blockingPredecessorNames('d', nodes, edges)).toEqual(['甲', '丙']);
  });
});

describe('rollback rule', () => {
  test('untouched successors do not block', () => {
    const nodes = [
      node('join', '汇合节点', 'completed'),
      node('a', aRoll, 'not_reached'),
      node('b', bRoll, 'not_reached'),
      node('ai', aiPost, 'not_reached'),
    ];
    expect(blockingSuccessorNames('join', nodes, fanInEdges())).toEqual([]);
  });

  test('names only the successors that have moved on', () => {
    const nodes = [
      node('join', '汇合节点', 'completed'),
      node('a', aRoll, 'in_progress'),
      node('b', bRoll, 'not_reached'),
      node('ai', aiPost, 'not_applicable'),
    ];
    const names = blockingSuccessorNames('join', nodes, fanInEdges());
    expect(names).toEqual([aRoll, aiPost]);
    expect(successorRefusalMessage(names)).toBe('无法回退，后续节点已推进：A-roll 拍摄、AI 后期');
  });

  test('rollback targets one legal step, and not_applicable clears to not_reached', () => {
    expect(rollbackTargetStatus('completed')).toBe('in_progress');
    expect(rollbackTargetStatus('in_progress')).toBe('not_reached');
    expect(rollbackTargetStatus('not_applicable')).toBe('not_reached');
    expect(rollbackTargetStatus('blocked')).toBeNull();
    expect(rollbackTargetStatus('not_reached')).toBeNull();
  });
});

describe('block reason and not_applicable pin', () => {
  test('blank reasons normalize to absent', () => {
    expect(normalizeBlockReason(undefined)).toBeNull();
    expect(normalizeBlockReason(null)).toBeNull();
    expect(normalizeBlockReason('')).toBeNull();
    expect(normalizeBlockReason(' \n\t ')).toBeNull();
    expect(normalizeBlockReason('  等素材 \n')).toBe('等素材');
  });

  test('a primary block item refuses the not_applicable marker', () => {
    expect(notApplicableBlockRefusal(false)).toBeNull();
    expect(notApplicableBlockRefusal(true)).toBe('不适用节点不能挂主阻塞事项');
  });
});

describe('publish bvid', () => {
  test('takes an explicit bvid or the id embedded in a URL', () => {
    expect(resolvePublishBvid({ bvid: ' BV1abc ' })).toEqual({ ok: true, bvid: 'BV1abc' });
    expect(resolvePublishBvid({ videoUrl: 'https://www.bilibili.com/video/BV1fromUrl' })).toEqual({
      ok: true,
      bvid: 'BV1fromUrl',
    });
    expect(resolvePublishBvid({ bvid: 'BV1abc', videoUrl: 'https://example.com/BV1abc' })).toEqual({
      ok: true,
      bvid: 'BV1abc',
    });
  });

  test('refuses a missing id and a URL that disagrees with bvid', () => {
    expect(resolvePublishBvid({ videoUrl: 'https://example.com/watch' })).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(resolvePublishBvid({})).toEqual({ ok: false, reason: 'missing' });
    expect(resolvePublishBvid({ bvid: 'BV1aaa', videoUrl: 'https://example.com/BV1bbb' })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });
});

describe('derived merge status', () => {
  const edges = fanInEdges();

  test('a merge waits until every predecessor is completed', () => {
    const waiting = [
      node('copy', copy, 'completed'),
      node('pre', preShoot, 'in_progress'),
      node('join', '汇合节点', 'not_reached', 'merge'),
    ];
    expect(derivedMergeStatus('join', waiting, edges)).toBe('not_reached');
    expect(blockingPredecessorNames('a', waiting, edges)).toEqual([preShoot]);
  });

  test('a satisfied merge counts as completed for its successors even if the stored status is still waiting', () => {
    const ready = [
      node('copy', copy, 'completed'),
      node('pre', preShoot, 'not_applicable'),
      node('join', '汇合节点', 'not_reached', 'merge'),
      node('a', aRoll, 'not_reached'),
    ];
    expect(derivedMergeStatus('join', ready, edges)).toBe('completed');
    expect(blockingPredecessorNames('a', ready, edges)).toEqual([]);
  });

  test('rolling a predecessor back returns the merge to waiting and names the moved downstream stage', () => {
    const rolled = [
      node('copy', copy, 'not_reached'),
      node('pre', preShoot, 'completed'),
      node('join', '汇合节点', 'completed', 'merge'),
      node('a', aRoll, 'not_reached'),
      node('b', bRoll, 'not_reached'),
      node('ai', aiPost, 'not_reached'),
    ];
    expect(derivedMergeStatus('join', rolled, edges)).toBe('not_reached');
    expect(blockingSuccessorNames('copy', rolled, edges)).toEqual([]);

    const moved = rolled.map((item) =>
      item.id === 'a' ? { ...item, status: 'in_progress' as const } : item,
    );
    expect(blockingSuccessorNames('copy', moved, edges)).toEqual([aRoll]);
  });
});

describe('predecessor completion plan', () => {
  test('orders a chain upstream first and then the nearer predecessor', () => {
    const nodes = [
      node('inq', '询单', 'not_reached'),
      node('outline', '大纲', 'not_reached'),
      node('copy', copy, 'not_reached'),
    ];
    const edges: EngineEdge[] = [
      { fromNodeId: 'inq', toNodeId: 'outline' },
      { fromNodeId: 'outline', toNodeId: 'copy' },
    ];
    expect(predecessorCompletionPlan('copy', nodes, edges).map((step) => step.name)).toEqual([
      '询单',
      '大纲',
    ]);
  });

  test('names both unfinished branches and skips a merge', () => {
    const nodes = [
      node('copy', copy, 'not_reached'),
      node('pre', preShoot, 'in_progress'),
      node('join', '汇合节点', 'not_reached', 'merge'),
      node('a', aRoll, 'not_reached'),
    ];
    expect(predecessorCompletionPlan('a', nodes, fanInEdges())).toEqual([
      { id: 'copy', name: copy, status: 'not_reached' },
      { id: 'pre', name: preShoot, status: 'in_progress' },
    ]);
  });
});
