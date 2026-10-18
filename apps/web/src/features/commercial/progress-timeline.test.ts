import { describe, expect, test } from 'bun:test';
import {
  ACHIEVEMENT_POINTS,
  PROGRESS_STAGES,
  deriveProgressTimeline,
  stageBlockLineLabel,
  stageIdForNode,
  stageSituationLabel,
  timelineFactsFromDetail,
  timelineStatusLabel,
  type TimelineSourceNode,
} from './progress-timeline';

function node(
  slug: string,
  name: string,
  status: string,
  blockingReason: string | null = null,
): TimelineSourceNode {
  return {
    id: `node-${slug}`,
    name,
    status,
    kind: slug === 'merge' ? 'merge' : 'stage',
    templateSlug: slug,
    blockingReason,
  };
}

const TEMPLATE = [
  node('inquiry', '询单', 'not_reached'),
  node('outline', '大纲', 'not_reached'),
  node('copy', '文案', 'not_reached'),
  node('pre_shoot', '预拍摄', 'not_reached'),
  node('merge', '汇合节点', 'not_reached'),
  node('a_roll', 'A-roll 拍摄', 'not_reached'),
  node('b_roll', 'B-roll 素材', 'not_reached'),
  node('ai_post', 'AI 后期', 'not_reached'),
  node('review', '审核', 'not_reached'),
  node('publish', '发布', 'not_reached'),
  node('distribution', '全平台分发', 'not_reached'),
  node('settlement', '结算', 'not_reached'),
  node('data_maint', '数据维护', 'not_reached'),
  node('other', '其他', 'not_reached'),
];

function withStatus(
  statuses: Record<string, string>,
  reasons: Record<string, string> = {},
): TimelineSourceNode[] {
  return TEMPLATE.map((item) => {
    const slug = item.templateSlug ?? '';
    const status = statuses[slug] ?? item.status;
    return { ...item, status, blockingReason: reasons[slug] ?? null };
  });
}

describe('progress timeline mapping', () => {
  test('places each content node on its stage and keeps merge off the line', () => {
    expect(stageIdForNode('outline')).toBe('write_outline');
    expect(stageIdForNode('copy')).toBe('copy_prep');
    expect(stageIdForNode('pre_shoot')).toBe('copy_prep');
    expect(stageIdForNode('manual')).toBe('copy_prep');
    expect(stageIdForNode('a_roll')).toBe('production');
    expect(stageIdForNode('b_roll')).toBe('production');
    expect(stageIdForNode('ai_post')).toBe('production');
    expect(stageIdForNode('review')).toBe('client_review');
    expect(stageIdForNode('publish')).toBe('client_review');
    expect(stageIdForNode('distribution')).toBe('distribution_settlement');
    expect(stageIdForNode('settlement')).toBe('distribution_settlement');
    expect(stageIdForNode('data_maint')).toBe('distribution_settlement');
    expect(stageIdForNode('other')).toBe('distribution_settlement');
    expect(stageIdForNode('inquiry')).toBeNull();
    expect(stageIdForNode('merge')).toBeNull();
  });

  test('maps persisted statuses onto the four colors, with not_applicable unfinished', () => {
    expect(timelineStatusLabel('completed')).toBe('完成');
    expect(timelineStatusLabel('done')).toBe('完成');
    expect(timelineStatusLabel('blocked')).toBe('阻塞');
    expect(timelineStatusLabel('in_progress')).toBe('进行中');
    expect(timelineStatusLabel('not_reached')).toBe('未完成');
    expect(timelineStatusLabel('not_applicable')).toBe('未完成');
  });

  test('derives six achievement points and five stages from a blocked copy node', () => {
    const timeline = deriveProgressTimeline(
      withStatus(
        {
          inquiry: 'completed',
          outline: 'completed',
          copy: 'blocked',
          pre_shoot: 'in_progress',
        },
        { copy: '甲方文案批注未清' },
      ),
    );
    expect(timeline.points.map((point) => point.id)).toEqual(ACHIEVEMENT_POINTS.map((p) => p.id));
    expect(timeline.stages.map((stage) => stage.id)).toEqual(PROGRESS_STAGES.map((s) => s.id));
    expect(timeline.points.map((point) => point.demoStatus)).toEqual([
      'done',
      'done',
      'idle',
      'idle',
      'idle',
      'idle',
    ]);
    expect(timeline.stages.map((stage) => [stage.id, stage.demoStatus, stage.current])).toEqual([
      ['write_outline', 'done', false],
      ['copy_prep', 'blocked', true],
      ['production', 'idle', false],
      ['client_review', 'idle', false],
      ['distribution_settlement', 'idle', false],
    ]);
    const copyPrep = timeline.stages[1];
    expect(copyPrep?.children.map((child) => child.nodeId)).toEqual(['copy', 'pre_shoot']);
    expect(copyPrep?.children.map((child) => child.demoStatus)).toEqual(['blocked', 'active']);
    expect(copyPrep?.blockers).toEqual([
      expect.objectContaining({ name: '文案', blockingReason: '甲方文案批注未清' }),
    ]);
    expect(stageSituationLabel(copyPrep!)).toBe('文案：阻塞');
    expect(stageBlockLineLabel(copyPrep!)).toBe('文案：阻塞');
    expect(stageBlockLineLabel(timeline.stages[0]!)).toBeNull();
    expect(stageSituationLabel(timeline.stages[0]!)).toBeNull();
    expect(
      stageBlockLineLabel({
        status: 'blocked',
        blockers: [
          { name: 'A-roll 拍摄', blockingReason: 'A-roll 素材版权待补' },
          { name: 'B-roll 素材', blockingReason: 'B-roll 甲方素材缺失' },
        ],
      }),
    ).toBe('A-roll 拍摄：阻塞、B-roll 素材：阻塞');
    expect(
      stageSituationLabel({
        status: 'in_progress',
        children: [
          { name: 'A-roll 拍摄', status: 'in_progress' },
          { name: 'B-roll 素材', status: 'in_progress' },
          { name: 'AI 后期', status: 'not_reached' },
        ],
        blockers: [],
      }),
    ).toBe('A-roll 拍摄、B-roll 素材');
    expect(
      timeline.stages.every((stage) => stage.children.every((child) => child.nodeId !== 'merge')),
    ).toBe(true);
  });

  test('resolves nodes by display name when the template slug is missing', () => {
    const timeline = deriveProgressTimeline([
      { id: 'a', name: '询单', status: 'completed', kind: 'stage' },
      { id: 'b', name: '大纲', status: 'in_progress', kind: 'stage' },
    ]);
    expect(timeline.points[0]?.demoStatus).toBe('done');
    expect(timeline.stages[0]?.children.map((child) => child.name)).toEqual(['大纲']);
    expect(timeline.stages[0]?.demoStatus).toBe('active');
  });

  test('treats not_applicable as unfinished color without blocking a finished stage', () => {
    const done = Object.fromEntries(TEMPLATE.map((item) => [item.templateSlug, 'completed']));
    const timeline = deriveProgressTimeline(withStatus({ ...done, other: 'not_applicable' }));
    const settlement = timeline.stages.find((stage) => stage.id === 'distribution_settlement');
    const other = settlement?.children.find((child) => child.nodeId === 'other');
    expect(other?.demoStatus).toBe('idle');
    expect(other?.statusLabel).toBe('未完成');
    expect(settlement?.status).toBe('completed');
    expect(timeline.points.at(-1)?.demoStatus).toBe('done');
    expect(timeline.stages.some((stage) => stage.current)).toBe(false);
  });

  test('reuses project detail fields for the summary facts', () => {
    const facts = timelineFactsFromDetail({
      id: 'f0010001-0001-4001-8001-000000000004',
      name: '甲方卡文案确认样例',
      netAmount: '18000.00',
      rebateAmount: '600.00',
      overallStage: 'pre_publish',
      currentStageNames: ['文案', '预拍摄'],
      anyNodeBlocked: true,
      blockingReason: '甲方文案批注未清',
      publish: { published: false, bvid: null, publishedAt: null, publishSource: null },
    });
    expect(facts).toEqual({
      netAmount: '18000.00',
      rebateAmount: '600.00',
      overallStage: 'pre_publish',
      overallStageLabel: '发布前',
      currentTasks: ['文案', '预拍摄'],
      published: false,
      publishedAt: null,
      blockingReason: '甲方文案批注未清',
    });
  });
});
