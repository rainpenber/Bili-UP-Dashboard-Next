import { describe, expect, test } from 'bun:test';
import type { EngineEdge } from './engine';
import {
  PROGRESS_STAGE_IDS,
  PROGRESS_STAGE_SLUGS,
  planNodeStep,
  planStageStep,
  type PlanNode,
  type StepPlan,
} from './step-plan';

function node(
  id: string,
  name: string,
  status: PlanNode['status'],
  extra: Partial<PlanNode> = {},
): PlanNode {
  return {
    id,
    name,
    status,
    kind: extra.kind ?? 'stage',
    templateSlug: extra.templateSlug ?? id,
    statusBeforeBlock: extra.statusBeforeBlock ?? null,
    blockItemId: extra.blockItemId ?? null,
    blockingReason: extra.blockingReason ?? null,
  };
}

const edges: EngineEdge[] = [
  { fromNodeId: 'inquiry', toNodeId: 'outline' },
  { fromNodeId: 'outline', toNodeId: 'copy' },
  { fromNodeId: 'outline', toNodeId: 'pre_shoot' },
  { fromNodeId: 'copy', toNodeId: 'merge' },
  { fromNodeId: 'pre_shoot', toNodeId: 'merge' },
  { fromNodeId: 'merge', toNodeId: 'a_roll' },
  { fromNodeId: 'merge', toNodeId: 'b_roll' },
  { fromNodeId: 'a_roll', toNodeId: 'edit' },
  { fromNodeId: 'b_roll', toNodeId: 'edit' },
  { fromNodeId: 'edit', toNodeId: 'ai_post' },
  { fromNodeId: 'ai_post', toNodeId: 'review' },
  { fromNodeId: 'review', toNodeId: 'publish' },
  { fromNodeId: 'publish', toNodeId: 'settlement' },
  { fromNodeId: 'publish', toNodeId: 'distribution' },
  { fromNodeId: 'publish', toNodeId: 'data_maint' },
  { fromNodeId: 'publish', toNodeId: 'other' },
];

function fresh(): PlanNode[] {
  return [
    node('inquiry', '询单', 'not_reached'),
    node('outline', '大纲', 'not_reached'),
    node('copy', '文案', 'not_reached'),
    node('pre_shoot', '预拍摄', 'not_reached'),
    node('merge', '汇合节点', 'not_reached', { kind: 'merge', templateSlug: 'merge' }),
    node('a_roll', 'A-roll 拍摄', 'not_reached'),
    node('b_roll', 'B-roll 素材', 'not_reached'),
    node('edit', '剪辑', 'not_reached'),
    node('ai_post', 'AI 后期', 'not_reached'),
    node('review', '审核', 'not_reached'),
    node('publish', '发布', 'not_reached'),
    node('settlement', '结算', 'not_reached'),
    node('distribution', '全平台分发', 'not_reached'),
    node('data_maint', '数据维护', 'not_reached'),
    node('other', '其他', 'not_reached'),
  ];
}

function ok(plan: StepPlan) {
  if (!plan.ok) throw new Error(`${plan.code} ${plan.error}`);
  return plan;
}

function targets(plan: StepPlan): Record<string, string> {
  const body = ok(plan);
  return Object.fromEntries(body.effects.map((item) => [item.nodeId, item.to]));
}

describe('node step plan', () => {
  test('advancing 文案 completes only its ancestors and leaves the parallel sibling', () => {
    const plan = ok(planNodeStep(fresh(), edges, 'copy', 'forward'));
    expect(plan.action).toBe('advance');
    expect(targets(plan)).toEqual({
      inquiry: 'completed',
      outline: 'completed',
      copy: 'in_progress',
    });
    expect(plan.publishNodeId).toBeNull();
    expect(plan.blocks).toEqual([]);
  });

  test('completing 文案 does not complete 预拍摄', () => {
    const nodes = fresh().map((item) => {
      if (item.id === 'inquiry' || item.id === 'outline')
        return { ...item, status: 'completed' as const };
      if (item.id === 'copy') return { ...item, status: 'in_progress' as const };
      return item;
    });
    const plan = ok(planNodeStep(nodes, edges, 'copy', 'forward'));
    expect(plan.action).toBe('complete');
    expect(targets(plan)).toEqual({ copy: 'completed' });
  });

  test('advancing A-roll completes both upstream branches and the merge, not B-roll', () => {
    const plan = ok(planNodeStep(fresh(), edges, 'a_roll', 'forward'));
    expect(targets(plan)).toEqual({
      inquiry: 'completed',
      outline: 'completed',
      copy: 'completed',
      pre_shoot: 'completed',
      merge: 'completed',
      a_roll: 'in_progress',
    });
    expect(targets(plan).b_roll).toBeUndefined();
  });

  test('a not_applicable merge stays untouched and does not hide unfinished ancestors', () => {
    const nodes = fresh().map((item) =>
      item.id === 'merge' ? { ...item, status: 'not_applicable' as const } : item,
    );
    const plan = ok(planNodeStep(nodes, edges, 'a_roll', 'forward'));
    expect(plan.effects.some((item) => item.nodeId === 'merge')).toBe(false);
    expect(targets(plan).copy).toBe('completed');
    expect(targets(plan).pre_shoot).toBe('completed');
    expect(targets(plan).a_roll).toBe('in_progress');
  });

  test('a blocked ancestor is listed and a blocked target only restores one step', () => {
    const nodes = fresh().map((item) => {
      if (item.id === 'outline') {
        return {
          ...item,
          status: 'blocked' as const,
          statusBeforeBlock: 'in_progress' as const,
          blockItemId: 'item-1',
          blockingReason: '等大纲',
        };
      }
      return item;
    });
    const advance = ok(planNodeStep(nodes, edges, 'copy', 'forward'));
    expect(advance.blocks).toEqual([
      { nodeId: 'outline', nodeName: '大纲', reason: '等大纲', itemId: 'item-1' },
    ]);
    expect(targets(advance).outline).toBe('completed');
    expect(targets(advance).copy).toBe('in_progress');

    const blockedCopy = nodes.map((item) =>
      item.id === 'copy'
        ? {
            ...item,
            status: 'blocked' as const,
            statusBeforeBlock: 'in_progress' as const,
            blockItemId: 'item-2',
            blockingReason: '等文案',
          }
        : item,
    );
    const restore = ok(planNodeStep(blockedCopy, edges, 'copy', 'forward'));
    expect(restore.action).toBe('unblock');
    expect(targets(restore)).toEqual({ copy: 'in_progress' });
    expect(restore.blocks[0]?.reason).toBe('等文案');
  });

  test('a completed node plans nothing', () => {
    const nodes = fresh().map((item) =>
      item.id === 'copy' ? { ...item, status: 'completed' as const } : item,
    );
    const plan = planNodeStep(nodes, edges, 'copy', 'forward');
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toBe('节点已完成');
  });

  test('an in-progress node with an open blocking item still requires confirmation', () => {
    const nodes = [
      node('copy', '文案', 'in_progress', {
        blockItemId: 'open-item',
        blockingReason: '等甲方',
      }),
    ];
    const plan = ok(planNodeStep(nodes, [], 'copy', 'forward'));
    expect(plan.action).toBe('complete');
    expect(targets(plan)).toEqual({ copy: 'completed' });
    expect(plan.blocks).toEqual([
      { nodeId: 'copy', nodeName: '文案', reason: '等甲方', itemId: 'open-item' },
    ]);
  });

  test('first advance of a not_reached node also confirms its open blocking item', () => {
    const nodes = [
      node('copy', '文案', 'not_reached', {
        blockItemId: 'open-item',
        blockingReason: '等甲方',
      }),
    ];
    const plan = ok(planNodeStep(nodes, [], 'copy', 'forward'));
    expect(targets(plan)).toEqual({ copy: 'in_progress' });
    expect(plan.blocks.map((item) => item.itemId)).toEqual(['open-item']);
  });

  test('merge is not a step target', () => {
    const plan = planNodeStep(fresh(), edges, 'merge', 'forward');
    expect(plan.ok).toBe(false);
  });

  test('rollback is one step and rewinds only a transparent merge', () => {
    const nodes = fresh().map((item) => {
      if (['inquiry', 'outline', 'copy', 'pre_shoot', 'merge'].includes(item.id)) {
        return { ...item, status: 'completed' as const };
      }
      return item;
    });
    const plan = ok(planNodeStep(nodes, edges, 'copy', 'rollback'));
    expect(plan.action).toBe('rollback');
    expect(targets(plan)).toEqual({ merge: 'not_reached', copy: 'in_progress' });
    expect(targets(plan).pre_shoot).toBeUndefined();
    expect(targets(plan).outline).toBeUndefined();
  });

  test('rollback refuses an advanced business successor and names it', () => {
    const nodes = fresh().map((item) => {
      if (['inquiry', 'outline', 'copy', 'pre_shoot', 'merge', 'a_roll'].includes(item.id)) {
        return { ...item, status: 'completed' as const };
      }
      return item;
    });
    const plan = planNodeStep(nodes, edges, 'copy', 'rollback');
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe('successors_advanced');
    expect(plan.successors.map((item) => item.nodeName)).toEqual(['A-roll 拍摄']);
    expect(plan.names).not.toContain('汇合节点');
  });
});

describe('stage step plan', () => {
  test('the first production advance opens only the legal frontier', () => {
    const plan = ok(planStageStep(fresh(), edges, 'production', 'forward'));
    expect(plan.action).toBe('advance');
    expect(targets(plan)).toEqual({
      inquiry: 'completed',
      outline: 'completed',
      copy: 'completed',
      pre_shoot: 'completed',
      merge: 'completed',
      a_roll: 'in_progress',
      b_roll: 'in_progress',
    });
    expect(targets(plan).edit).toBeUndefined();
    expect(targets(plan).ai_post).toBeUndefined();
    expect(targets(plan).review).toBeUndefined();
  });

  test('advancing 甲方审核 starts 审核 and leaves 发布 unstarted', () => {
    const plan = ok(planStageStep(fresh(), edges, 'client_review', 'forward'));
    expect(targets(plan).review).toBe('in_progress');
    expect(targets(plan).publish).toBeUndefined();
    expect(targets(plan).a_roll).toBe('completed');
    expect(targets(plan).settlement).toBeUndefined();
    expect(plan.publishNodeId).toBeNull();
  });

  test('completing 甲方审核 completes 审核 and 发布 and not the next stage', () => {
    const nodes = fresh().map((item) => {
      if (
        [
          'inquiry',
          'outline',
          'copy',
          'pre_shoot',
          'merge',
          'a_roll',
          'b_roll',
          'edit',
          'ai_post',
        ].includes(item.id)
      ) {
        return { ...item, status: 'completed' as const };
      }
      if (item.id === 'review') return { ...item, status: 'in_progress' as const };
      return item;
    });
    const plan = ok(planStageStep(nodes, edges, 'client_review', 'forward'));
    expect(plan.action).toBe('complete');
    expect(targets(plan)).toEqual({ review: 'completed', publish: 'completed' });
    expect(plan.publishNodeId).toBe('publish');
    expect(targets(plan).settlement).toBeUndefined();
  });

  test('a second complete of a finished stage is refused', () => {
    const nodes = fresh().map((item) =>
      item.templateSlug === 'outline' ? { ...item, status: 'completed' as const } : item,
    );
    const plan = planStageStep(nodes, edges, 'write_outline', 'forward');
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toBe('阶段已完成');
  });

  test('a stage whose members are all not_applicable counts as complete', () => {
    const nodes = fresh().map((item) =>
      ['a_roll', 'b_roll', 'edit', 'ai_post'].includes(item.id)
        ? { ...item, status: 'not_applicable' as const }
        : item,
    );
    const plan = planStageStep(nodes, edges, 'production', 'forward');
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toBe('阶段已完成');
  });

  test('every stage is complete when all nodes are completed or not_applicable', () => {
    const nodes = fresh().map((item) => ({
      ...item,
      status: item.id === 'inquiry' ? ('completed' as const) : ('not_applicable' as const),
    }));
    for (const stageId of PROGRESS_STAGE_IDS) {
      const plan = planStageStep(nodes, edges, stageId, 'forward');
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error).toBe('阶段已完成');
    }
  });

  test('rolling a finished serial stage moves only the exit back to in_progress', () => {
    const nodes = fresh().map((item) => {
      if (['review', 'publish', 'a_roll'].includes(item.id))
        return { ...item, status: 'completed' as const };
      return item;
    });
    const plan = ok(planStageStep(nodes, edges, 'client_review', 'rollback'));
    expect(targets(plan)).toEqual({ publish: 'in_progress' });
  });

  test('rolling an in-progress stage returns its members to not_reached and keeps other stages', () => {
    const nodes = fresh().map((item) => {
      if (['inquiry', 'outline', 'copy', 'pre_shoot', 'merge'].includes(item.id)) {
        return { ...item, status: 'completed' as const };
      }
      if (['a_roll', 'b_roll', 'edit', 'ai_post'].includes(item.id))
        return { ...item, status: 'in_progress' as const };
      return item;
    });
    const plan = ok(planStageStep(nodes, edges, 'production', 'rollback'));
    expect(targets(plan)).toEqual({
      a_roll: 'not_reached',
      b_roll: 'not_reached',
      edit: 'not_reached',
      ai_post: 'not_reached',
    });
  });

  test('stage rollback refuses outside successors and does not list the merge', () => {
    const nodes = fresh().map((item) => {
      if (item.id === 'settlement') return { ...item, status: 'in_progress' as const };
      if (['review', 'publish'].includes(item.id)) return { ...item, status: 'completed' as const };
      return item;
    });
    const plan = planStageStep(nodes, edges, 'client_review', 'rollback');
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.successors.map((item) => item.nodeId)).toEqual(['settlement']);
  });

  test('first production advance does not complete an outside node that still depends on a member', () => {
    const nodes = [
      node('a_roll', 'A-roll 拍摄', 'not_reached'),
      node('review', '审核', 'not_reached'),
      node('b_roll', 'B-roll 素材', 'not_reached'),
    ];
    const linked: EngineEdge[] = [
      { fromNodeId: 'a_roll', toNodeId: 'review' },
      { fromNodeId: 'review', toNodeId: 'b_roll' },
    ];
    const plan = ok(planStageStep(nodes, linked, 'production', 'forward'));
    expect(plan.action).toBe('advance');
    expect(targets(plan)).toEqual({ a_roll: 'in_progress' });
    expect(plan.effects.some((item) => item.nodeId === 'review')).toBe(false);
  });

  test('completing that stage orders the outside node after its member predecessor', () => {
    const nodes = [
      node('a_roll', 'A-roll 拍摄', 'in_progress'),
      node('review', '审核', 'not_reached'),
      node('b_roll', 'B-roll 素材', 'not_reached'),
    ];
    const linked: EngineEdge[] = [
      { fromNodeId: 'a_roll', toNodeId: 'review' },
      { fromNodeId: 'review', toNodeId: 'b_roll' },
    ];
    const plan = ok(planStageStep(nodes, linked, 'production', 'forward'));
    expect(plan.action).toBe('complete');
    expect(plan.effects.map((item) => `${item.nodeId}:${item.to}`)).toEqual([
      'a_roll:completed',
      'review:completed',
      'b_roll:completed',
    ]);
  });

  test('rollback of that stage moves only the downstream member and then stops at the outside node', () => {
    const linked: EngineEdge[] = [
      { fromNodeId: 'a_roll', toNodeId: 'review' },
      { fromNodeId: 'review', toNodeId: 'b_roll' },
    ];
    const done = [
      node('a_roll', 'A-roll 拍摄', 'completed'),
      node('review', '审核', 'completed'),
      node('b_roll', 'B-roll 素材', 'completed'),
    ];
    const once = ok(planStageStep(done, linked, 'production', 'rollback'));
    expect(targets(once)).toEqual({ b_roll: 'in_progress' });
    const midway = done.map((item) =>
      item.id === 'b_roll' ? { ...item, status: 'in_progress' as const } : item,
    );
    const twice = planStageStep(midway, linked, 'production', 'rollback');
    expect(twice.ok).toBe(false);
    if (twice.ok) return;
    expect(twice.successors.map((item) => item.nodeId)).toEqual(['review']);
  });

  test('production includes the 剪辑 node in template order', () => {
    expect(PROGRESS_STAGE_SLUGS.production).toEqual(['a_roll', 'b_roll', 'edit', 'ai_post']);
  });

  test('advancing 剪辑 is legal and completes only its unfinished ancestors', () => {
    const plan = ok(planNodeStep(fresh(), edges, 'edit', 'forward'));
    expect(plan.action).toBe('advance');
    expect(targets(plan).edit).toBe('in_progress');
    expect(targets(plan).ai_post).toBeUndefined();
    expect(targets(plan).review).toBeUndefined();
  });

  test('completing 剪辑 does not complete AI 后期 or 审核', () => {
    const nodes = fresh().map((item) => {
      if (
        ['inquiry', 'outline', 'copy', 'pre_shoot', 'merge', 'a_roll', 'b_roll'].includes(item.id)
      ) {
        return { ...item, status: 'completed' as const };
      }
      if (item.id === 'edit') return { ...item, status: 'in_progress' as const };
      return item;
    });
    const plan = ok(planNodeStep(nodes, edges, 'edit', 'forward'));
    expect(plan.action).toBe('complete');
    expect(targets(plan)).toEqual({ edit: 'completed' });
    expect(targets(plan).ai_post).toBeUndefined();
  });

  test('rolling 剪辑 back is legal while AI 后期 is untouched', () => {
    const nodes = fresh().map((item) => {
      if (
        ['inquiry', 'outline', 'copy', 'pre_shoot', 'merge', 'a_roll', 'b_roll'].includes(item.id)
      ) {
        return { ...item, status: 'completed' as const };
      }
      if (item.id === 'edit') return { ...item, status: 'completed' as const };
      return item;
    });
    const plan = ok(planNodeStep(nodes, edges, 'edit', 'rollback'));
    expect(plan.action).toBe('rollback');
    expect(targets(plan)).toEqual({ edit: 'in_progress' });
  });

  test('a blocked stage complete lists the block and still scopes to that stage', () => {
    const nodes = fresh().map((item) => {
      if (item.id === 'copy') {
        return {
          ...item,
          status: 'blocked' as const,
          blockItemId: 'item-copy',
          blockingReason: '甲方未回',
          statusBeforeBlock: 'in_progress' as const,
        };
      }
      if (item.id === 'pre_shoot') return { ...item, status: 'in_progress' as const };
      if (item.id === 'inquiry' || item.id === 'outline')
        return { ...item, status: 'completed' as const };
      return item;
    });
    const plan = ok(planStageStep(nodes, edges, 'copy_prep', 'forward'));
    expect(plan.action).toBe('complete');
    expect(targets(plan)).toEqual({ copy: 'completed', pre_shoot: 'completed' });
    expect(plan.blocks.map((item) => item.nodeId)).toEqual(['copy']);
    expect(targets(plan).a_roll).toBeUndefined();
  });
});
