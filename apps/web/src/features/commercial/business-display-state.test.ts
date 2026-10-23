import { describe, expect, test } from 'bun:test';
import {
  applyBusinessStateToDerivedTimeline,
  applyBusinessStateToLiveNodes,
  applyBusinessStateToTimelineNodes,
  businessStateListBadge,
  businessStateOverallStageLabel,
  displayNodeStatusForBusinessState,
  isBusinessStateReadOnly,
} from './business-display-state';
import { deriveProgressTimeline } from './progress-timeline';

describe('business display state overlay', () => {
  test('finished forces completed green statuses without inventing completion times', () => {
    expect(displayNodeStatusForBusinessState('not_reached', 'finished')).toBe('completed');
    expect(displayNodeStatusForBusinessState('blocked', 'finished')).toBe('completed');
    const nodes = applyBusinessStateToTimelineNodes(
      [
        {
          id: 'a',
          name: '大纲',
          status: 'not_reached',
          blockingReason: 'x',
          completedAt: null,
          plannedAt: null,
        },
      ],
      'finished',
    );
    expect(nodes[0]?.status).toBe('completed');
    expect(nodes[0]?.blockingReason).toBeNull();
    expect(nodes[0]?.completedAt).toBeNull();
  });

  test('not_started forces grey not_reached statuses', () => {
    expect(displayNodeStatusForBusinessState('completed', 'not_started')).toBe('not_reached');
    expect(displayNodeStatusForBusinessState('in_progress', 'not_started')).toBe('not_reached');
    const live = applyBusinessStateToLiveNodes(
      [{ id: 'a', name: '大纲', status: 'in_progress', kind: 'stage' }],
      'not_started',
    );
    expect(live[0]?.status).toBe('not_reached');
  });

  test('active and unbound leave node statuses alone', () => {
    expect(displayNodeStatusForBusinessState('blocked', 'active')).toBe('blocked');
    expect(displayNodeStatusForBusinessState('blocked', null)).toBe('blocked');
    const nodes = applyBusinessStateToTimelineNodes(
      [{ id: 'a', name: '大纲', status: 'blocked', blockingReason: '卡' }],
      'active',
    );
    expect(nodes[0]?.status).toBe('blocked');
    expect(nodes[0]?.blockingReason).toBe('卡');
  });

  test('overall stage label and list badge use real source labels', () => {
    expect(businessStateOverallStageLabel('finished', '发布前')).toBe('已结束');
    expect(businessStateOverallStageLabel('not_started', '发布前')).toBe('未开始');
    expect(businessStateOverallStageLabel('active', '发布前')).toBe('发布前');
    expect(businessStateListBadge('finished', '3.收尾-已提现')).toEqual({
      tone: 'finished',
      text: '已结束 · 3.收尾-已提现',
    });
    expect(businessStateListBadge('not_started', '1.放弃-主动拒绝')).toEqual({
      tone: 'not_started',
      text: '未开始 · 1.放弃-主动拒绝',
    });
    expect(businessStateListBadge('active', '2.进行中')).toBeNull();
    expect(businessStateListBadge(null, null)).toBeNull();
  });

  test('finished and not_started are display read-only', () => {
    expect(isBusinessStateReadOnly('finished')).toBe(true);
    expect(isBusinessStateReadOnly('not_started')).toBe(true);
    expect(isBusinessStateReadOnly('active')).toBe(false);
    expect(isBusinessStateReadOnly(null)).toBe(false);
  });

  test('derived timeline overlay paints empty stages finished or idle', () => {
    const base = deriveProgressTimeline([
      { id: 'n1', name: '大纲', status: 'in_progress', templateSlug: 'outline' },
    ]);
    const finished = applyBusinessStateToDerivedTimeline(base, 'finished');
    expect(finished.stages.every((stage) => stage.demoStatus === 'done')).toBe(true);
    expect(finished.points.every((point) => point.demoStatus === 'done')).toBe(true);
    const idle = applyBusinessStateToDerivedTimeline(base, 'not_started');
    expect(idle.stages.every((stage) => stage.demoStatus === 'idle')).toBe(true);
    expect(idle.points.every((point) => point.demoStatus === 'idle')).toBe(true);
  });
});
