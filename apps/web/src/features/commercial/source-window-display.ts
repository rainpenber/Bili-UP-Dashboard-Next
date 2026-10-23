import type { CommercialSourceWindow } from '@studio/contracts';
import { sourceWindowHasDates } from '@studio/contracts';
import { formatScheduleLabel } from './node-schedule';

/** Friendly origin label for the source binding; dates stay unconfirmed. */
export function sourceWindowOriginLabel(namespace: string | null | undefined): string {
  if (!namespace) return '商单源';
  const lower = namespace.toLowerCase();
  if (lower.includes('wechat') || lower.includes('weixin') || lower.startsWith('hermes')) {
    return '微信商单源';
  }
  return '商单源';
}

/** Format start–end (and optional reminder) for read-only copy. */
export function formatSourceWindowRange(window: CommercialSourceWindow): string | null {
  if (!sourceWindowHasDates(window)) return null;
  const start = window.startAt ? formatScheduleLabel(window.startAt) : null;
  const end = window.endAt ? formatScheduleLabel(window.endAt) : null;
  if (start && end) return `${start}–${end}`;
  if (start) return `${start}起`;
  if (end) return `至${end}`;
  if (window.reminderAt) return `提醒 ${formatScheduleLabel(window.reminderAt)}`;
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
