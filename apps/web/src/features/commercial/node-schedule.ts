import { toDemoStatus } from './workflow-status-map';
import {
  timelineStatusLabel,
  type TimelineProjectFacts,
  type TimelineSourceNode,
} from './progress-timeline';
import type { MockStatus } from '../workflow-mock/flow-nodes';

const SHANGHAI = 'Asia/Shanghai';

export type ShanghaiClock = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

export function shanghaiClock(iso: string): ShanghaiClock | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = bag.hour === '24' ? '00' : (bag.hour ?? '00');
  return {
    year: bag.year ?? '0000',
    month: bag.month ?? '01',
    day: bag.day ?? '01',
    hour,
    minute: bag.minute ?? '00',
    second: bag.second ?? '00',
  };
}

/** Shanghai midnight marks a calendar date. Any other clock time is an exact appointment. */
export function isCalendarDateInstant(iso: string): boolean {
  const clock = shanghaiClock(iso);
  if (!clock) return false;
  return clock.hour === '00' && clock.minute === '00' && clock.second === '00';
}

export function calendarDayKey(iso: string): string | null {
  const clock = shanghaiClock(iso);
  if (!clock) return null;
  return `${clock.year}-${clock.month}-${clock.day}`;
}

export function formatScheduleLabel(iso: string): string {
  const clock = shanghaiClock(iso);
  if (!clock) return iso;
  const month = Number(clock.month);
  const day = Number(clock.day);
  const date = `${month}月${day}日`;
  if (isCalendarDateInstant(iso)) return date;
  return `${date} ${clock.hour}:${clock.minute}`;
}

export function isScheduleOverdue(iso: string, now: Date): boolean {
  const clock = shanghaiClock(iso);
  const today = shanghaiClock(now.toISOString());
  if (!clock || !today) return false;
  const day = `${clock.year}-${clock.month}-${clock.day}`;
  const todayKey = `${today.year}-${today.month}-${today.day}`;
  if (isCalendarDateInstant(iso)) return day < todayKey;
  return new Date(iso).getTime() < now.getTime() && day <= todayKey;
}

export type ScheduleSummary =
  | {
      kind: 'next';
      nodeId: string;
      name: string;
      dateLabel: string;
      overdue: boolean;
      overallStageLabel: string;
    }
  | { kind: 'unscheduled'; overallStageLabel: string }
  | { kind: 'published'; dateLabel: string | null; overallStageLabel: string }
  | { kind: 'closed'; title: string; overallStageLabel: string };

export type ScheduleRecord = {
  id: string;
  name: string;
  status: string;
  demoStatus: MockStatus;
  statusLabel: string;
  planLabel: string | null;
  actualLabel: string | null;
  overdue: boolean;
  blockingReason: string | null;
};

export type KeySchedule = {
  summary: ScheduleSummary;
  records: ScheduleRecord[];
  pendingNames: string[];
};

function isDeliveryNode(node: TimelineSourceNode): boolean {
  if (node.kind === 'merge') return false;
  if (node.status === 'not_applicable') return false;
  return true;
}

function isOpen(node: TimelineSourceNode): boolean {
  return node.status !== 'completed' && node.status !== 'done';
}

type Ranked = TimelineSourceNode & { index: number };

function byPlan(left: Ranked, right: Ranked): number {
  const leftAt = left.plannedAt ? Date.parse(left.plannedAt) : Number.POSITIVE_INFINITY;
  const rightAt = right.plannedAt ? Date.parse(right.plannedAt) : Number.POSITIVE_INFINITY;
  if (leftAt !== rightAt) return leftAt - rightAt;
  return left.index - right.index;
}

export function deriveKeySchedule(
  nodes: TimelineSourceNode[],
  facts: TimelineProjectFacts | null,
  now = new Date(),
): KeySchedule {
  const ranked: Ranked[] = nodes.map((node, index) => ({ ...node, index }));
  const business = ranked.filter(isDeliveryNode);
  const openPlanned = business.filter((node) => isOpen(node) && node.plannedAt).sort(byPlan);
  const next = openPlanned[0];
  const overallStageLabel = facts?.overallStageLabel ?? '';
  let summary: ScheduleSummary;
  if (next?.plannedAt) {
    summary = {
      kind: 'next',
      nodeId: next.id,
      name: next.name,
      dateLabel: formatScheduleLabel(next.plannedAt),
      overdue: isScheduleOverdue(next.plannedAt, now),
      overallStageLabel,
    };
  } else if (facts && (facts.overallStage === 'closed' || facts.overallStage === 'archived')) {
    summary = {
      kind: 'closed',
      title: facts.overallStage === 'archived' ? '已归档' : '已结案',
      overallStageLabel,
    };
  } else if (facts?.published) {
    summary = {
      kind: 'published',
      dateLabel: facts.publishedAt ? formatScheduleLabel(facts.publishedAt) : null,
      overallStageLabel,
    };
  } else {
    summary = { kind: 'unscheduled', overallStageLabel };
  }

  const dated = business
    .filter((node) => node.plannedAt || node.completedAt)
    .sort((left, right) => {
      const leftKey = left.plannedAt ?? left.completedAt ?? '';
      const rightKey = right.plannedAt ?? right.completedAt ?? '';
      const delta = Date.parse(leftKey) - Date.parse(rightKey);
      if (delta !== 0) return delta;
      return left.index - right.index;
    });

  const records: ScheduleRecord[] = dated.map((node) => ({
    id: node.id,
    name: node.name,
    status: node.status,
    demoStatus: toDemoStatus(node.status),
    statusLabel: timelineStatusLabel(node.status),
    planLabel: node.plannedAt ? formatScheduleLabel(node.plannedAt) : null,
    actualLabel: node.completedAt ? formatScheduleLabel(node.completedAt) : null,
    overdue: Boolean(node.plannedAt && isOpen(node) && isScheduleOverdue(node.plannedAt, now)),
    blockingReason:
      node.status === 'blocked' && node.blockingReason && node.blockingReason.trim().length > 0
        ? node.blockingReason.trim()
        : null,
  }));

  const pendingNames = business
    .filter((node) => isOpen(node) && !node.plannedAt)
    .sort((left, right) => left.index - right.index)
    .map((node) => node.name);

  return { summary, records, pendingNames };
}
