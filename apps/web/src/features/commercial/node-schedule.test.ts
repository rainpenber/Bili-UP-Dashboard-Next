import { describe, expect, test } from 'bun:test';
import {
  calendarDayKey,
  deriveKeySchedule,
  formatScheduleLabel,
  isCalendarDateInstant,
  isScheduleOverdue,
} from './node-schedule';
import type { TimelineProjectFacts, TimelineSourceNode } from './progress-timeline';

const NOW = new Date('2026-04-10T04:00:00.000Z');

function facts(overrides: Partial<TimelineProjectFacts> = {}): TimelineProjectFacts {
  return {
    netAmount: null,
    rebateAmount: null,
    overallStage: 'pre_publish',
    overallStageLabel: '发布前',
    currentTasks: [],
    published: false,
    publishedAt: null,
    blockingReason: null,
    ...overrides,
  };
}

function node(
  id: string,
  name: string,
  status: string,
  extra: Partial<TimelineSourceNode> = {},
): TimelineSourceNode {
  return {
    id,
    name,
    status,
    kind: 'stage',
    templateSlug: id,
    ...extra,
  };
}

describe('schedule dates', () => {
  test('formats a Shanghai calendar date without turning midnight into 00:00', () => {
    const stored = new Date('2026-04-02T00:00:00+08:00').toISOString();
    expect(isCalendarDateInstant(stored)).toBe(true);
    expect(formatScheduleLabel(stored)).toBe('4月2日');
    expect(formatScheduleLabel(stored)).not.toContain('00:00');
    expect(calendarDayKey(stored)).toBe('2026-04-02');
  });

  test('keeps an exact clock time as hour and minute, without seconds', () => {
    const stored = new Date('2026-04-02T14:30:45+08:00').toISOString();
    expect(isCalendarDateInstant(stored)).toBe(false);
    expect(formatScheduleLabel(stored)).toBe('4月2日 14:30');
    expect(formatScheduleLabel(stored)).not.toContain('45');
  });

  test('a calendar date is overdue only after that Shanghai day', () => {
    const today = new Date('2026-04-10T00:00:00+08:00').toISOString();
    const yesterday = new Date('2026-04-09T00:00:00+08:00').toISOString();
    expect(isScheduleOverdue(today, NOW)).toBe(false);
    expect(isScheduleOverdue(yesterday, NOW)).toBe(true);
    expect(isScheduleOverdue(new Date('2026-04-10T13:00:00+08:00').toISOString(), NOW)).toBe(false);
    expect(isScheduleOverdue(new Date('2026-04-10T11:00:00+08:00').toISOString(), NOW)).toBe(true);
  });
});

describe('next delivery', () => {
  test('picks the earliest open plan, including a future not-started node, and keeps same-day order', () => {
    const sameDay = new Date('2026-04-12T00:00:00+08:00').toISOString();
    const schedule = deriveKeySchedule(
      [
        node('merge', '汇合节点', 'not_reached', {
          kind: 'merge',
          plannedAt: new Date('2026-04-01T00:00:00+08:00').toISOString(),
        }),
        node('other', '其他', 'not_applicable', {
          plannedAt: new Date('2026-04-01T00:00:00+08:00').toISOString(),
        }),
        node('review', '审核', 'not_reached', { plannedAt: sameDay }),
        node('publish', '发布', 'not_reached', { plannedAt: sameDay }),
        node('copy', '文案', 'not_reached', {
          plannedAt: new Date('2026-04-20T00:00:00+08:00').toISOString(),
        }),
      ],
      facts(),
      NOW,
    );
    expect(schedule.summary).toMatchObject({
      kind: 'next',
      name: '审核',
      dateLabel: '4月12日',
      overdue: false,
    });
    expect(schedule.records.map((row) => row.name)).toEqual(['审核', '发布', '文案']);
    expect(schedule.records.some((row) => row.name === '汇合节点' || row.name === '其他')).toBe(
      false,
    );
  });

  test('does not skip an overdue open node in favor of a later plan', () => {
    const schedule = deriveKeySchedule(
      [
        node('copy', '文案', 'blocked', {
          plannedAt: new Date('2026-04-01T00:00:00+08:00').toISOString(),
          blockingReason: '等甲方',
        }),
        node('pre_shoot', '预拍摄', 'not_reached', {
          plannedAt: new Date('2026-04-18T00:00:00+08:00').toISOString(),
        }),
      ],
      facts(),
      NOW,
    );
    expect(schedule.summary).toMatchObject({
      kind: 'next',
      name: '文案',
      overdue: true,
      dateLabel: '4月1日',
    });
    expect(schedule.records.find((row) => row.name === '文案')).toMatchObject({
      planLabel: '4月1日',
      actualLabel: null,
      blockingReason: '等甲方',
      overdue: true,
    });
  });

  test('says the schedule is unconfirmed when nothing is planned, without using elapsed time', () => {
    const schedule = deriveKeySchedule(
      [
        node('copy', '文案', 'in_progress', { updatedAt: '2020-01-01T00:00:00.000Z' }),
        node('pre_shoot', '预拍摄', 'not_reached'),
      ],
      facts(),
      NOW,
    );
    expect(schedule.summary.kind).toBe('unscheduled');
    expect(schedule.records).toEqual([]);
    expect(schedule.pendingNames).toEqual(['文案', '预拍摄']);
  });

  test('uses the real publish date only when nothing else is still scheduled', () => {
    const publishedAt = new Date('2026-05-20T12:00:00.000Z').toISOString();
    const open = deriveKeySchedule(
      [
        node('publish', '发布', 'completed'),
        node('settlement', '结算', 'in_progress', {
          plannedAt: new Date('2026-06-01T00:00:00+08:00').toISOString(),
        }),
      ],
      facts({
        overallStage: 'published_winding_down',
        overallStageLabel: '已上线，收尾中',
        published: true,
        publishedAt,
      }),
      NOW,
    );
    expect(open.summary).toMatchObject({ kind: 'next', name: '结算' });
    expect(open.records.find((row) => row.name === '发布')).toBeUndefined();

    const done = deriveKeySchedule(
      [node('publish', '发布', 'completed', { completedAt: publishedAt })],
      facts({
        overallStage: 'published_winding_down',
        overallStageLabel: '已上线，收尾中',
        published: true,
        publishedAt,
      }),
      NOW,
    );
    expect(done.summary).toMatchObject({ kind: 'published', dateLabel: '5月20日 20:00' });
    expect(done.records[0]).toMatchObject({
      name: '发布',
      planLabel: null,
      actualLabel: '5月20日 20:00',
    });
  });

  test('a closed project with no next delivery does not invent a task', () => {
    const schedule = deriveKeySchedule(
      [
        node('settlement', '结算', 'completed', {
          completedAt: new Date('2026-04-01T16:00:00+08:00').toISOString(),
        }),
      ],
      facts({ overallStage: 'closed', overallStageLabel: '已结案' }),
      NOW,
    );
    expect(schedule.summary).toEqual({
      kind: 'closed',
      title: '已结案',
      overallStageLabel: '已结案',
    });
    expect(schedule.summary.kind === 'closed' ? schedule.summary.title : '').not.toBe('结算');
  });
});
