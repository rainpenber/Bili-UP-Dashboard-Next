import type { CommercialSourceWindow } from '@studio/contracts';
import { sourceWindowHasDates } from '@studio/contracts';
import { shanghaiClock } from './node-schedule';

/** Friendly origin label for the source binding; dates stay unconfirmed. */
export function sourceWindowOriginLabel(namespace: string | null | undefined): string {
  if (!namespace) return '商单源';
  const lower = namespace.toLowerCase();
  if (lower.includes('wechat') || lower.includes('weixin') || lower.startsWith('hermes')) {
    return '微信商单源';
  }
  return '商单源';
}

/**
 * Source window dates are calendar facts (often naive UTC midnight), not appointments.
 * Always Asia/Shanghai calendar day — never hours/minutes, never shift to the previous day
 * when the instant is UTC date-zero (08:00 CST).
 */
export function formatSourceWindowDate(iso: string): string | null {
  const clock = shanghaiClock(iso);
  if (!clock) return null;
  return `${Number(clock.month)}月${Number(clock.day)}日`;
}

/** Format start–end (and optional reminder) for read-only copy. Date only. */
export function formatSourceWindowRange(window: CommercialSourceWindow): string | null {
  if (!sourceWindowHasDates(window)) return null;
  const start = window.startAt ? formatSourceWindowDate(window.startAt) : null;
  const end = window.endAt ? formatSourceWindowDate(window.endAt) : null;
  if (start && end) return start === end ? start : `${start}–${end}`;
  if (start) return `${start}起`;
  if (end) return `至${end}`;
  if (window.reminderAt) {
    const reminder = formatSourceWindowDate(window.reminderAt);
    return reminder ? `提醒 ${reminder}` : null;
  }
  return null;
}

export type SourceWindowCardCopy =
  | { kind: 'none' }
  | { kind: 'empty'; originLabel: string }
  | { kind: 'range'; rangeLabel: string; originLabel: string };

/**
 * Read-only card copy for the schedule summary.
 * Never implies the window is a confirmed project plan.
 */
export function sourceWindowCardCopy(
  window: CommercialSourceWindow | null,
  namespace: string | null | undefined,
): SourceWindowCardCopy {
  if (!window) return { kind: 'none' };
  const originLabel = sourceWindowOriginLabel(namespace);
  const rangeLabel = formatSourceWindowRange(window);
  if (!rangeLabel) return { kind: 'empty', originLabel };
  return { kind: 'range', rangeLabel, originLabel };
}
