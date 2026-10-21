import { parseMonitorStartAtInput, type MonitorTargetType } from '@studio/contracts';
import { datetimeLocalToOffsetIso } from '@/lib/datetime-local';

/**
 * Resolve optional video startAt from a datetime-local field.
 * Empty → omit. Non-empty → local-offset ISO validated by contracts.
 */
export function resolveOptionalVideoStartAt(
  type: MonitorTargetType,
  localValue: string,
): { ok: true; startAt?: string } | { ok: false; message: string } {
  if (type !== 'video') return { ok: true };
  const trimmed = localValue.trim();
  if (!trimmed) return { ok: true };
  try {
    const startAt = datetimeLocalToOffsetIso(trimmed);
    parseMonitorStartAtInput(startAt);
    return { ok: true, startAt };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '请输入合法的计划上线时间',
    };
  }
}
