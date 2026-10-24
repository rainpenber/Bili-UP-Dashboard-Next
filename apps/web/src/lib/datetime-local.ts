import { formatFullLocalTime } from '@/lib/format-time';

/**
 * Convert a `datetime-local` value to an ISO-8601 string with an explicit
 * local offset (e.g. 2026-11-01T09:30:00+08:00). Never use `toISOString()`
 * here — that would shift the civil clock into UTC and confuse users.
 */
export function datetimeLocalToOffsetIso(value: string): string {
  const trimmed = value.trim();
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!matched) {
    throw new Error('请输入合法的计划上线时间');
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const second = Number(matched[6] ?? '0');
  const probe = new Date(year, month - 1, day, hour, minute, second);
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day ||
    probe.getHours() !== hour ||
    probe.getMinutes() !== minute ||
    probe.getSeconds() !== second
  ) {
    throw new Error('请输入合法的计划上线时间');
  }
  const offsetMin = -probe.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${sign}${oh}:${om}`;
}

/** Map a stored ISO instant back into a `datetime-local` value in local time. */
export function offsetIsoToDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatStartAtDisplay(iso: string | null): string {
  if (!iso) return '未设置（立即开始）';
  return formatFullLocalTime(iso);
}
