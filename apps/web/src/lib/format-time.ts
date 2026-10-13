const MS_DAY = 86_400_000;
const DISPLAY_TZ = 'Asia/Shanghai';

function parseInstant(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 完整本地时间（tooltip / 详情） */
export function formatFullLocalTime(iso: string): string {
  const d = parseInstant(iso);
  if (!d) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: DISPLAY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/** 轴标签：同日仅 M/D，跨日或含时分则 M/D HH:mm */
export function formatAxisTime(iso: string, sameDayAs?: string): string {
  const d = parseInstant(iso);
  if (!d) return iso;
  const ref = sameDayAs ? parseInstant(sameDayAs) : null;
  const sameDay =
    ref &&
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  }
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
  if (hasTime) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  }
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(d);
}

/** 列表 / 卡片：相对时间或 M/D HH:mm */
export function formatShortTime(iso: string, now = Date.now()): string {
  const d = parseInstant(iso);
  if (!d) return iso;
  const diff = now - d.getTime();
  if (diff >= 0 && diff < 60_000) return '刚刚';
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff >= 0 && diff < MS_DAY) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff >= 0 && diff < 7 * MS_DAY) return `${Math.floor(diff / MS_DAY)} 天前`;
  return formatAxisTime(iso);
}

export function formatAxisLabels(times: string[]): string[] {
  if (times.length === 0) return [];
  const first = times[0]!;
  const allSameDay = times.every((t) => {
    const d = parseInstant(t);
    const f = parseInstant(first);
    if (!d || !f) return false;
    return (
      d.getFullYear() === f.getFullYear() &&
      d.getMonth() === f.getMonth() &&
      d.getDate() === f.getDate()
    );
  });
  if (allSameDay) {
    return times.map((t) => formatAxisTime(t, first));
  }
  return times.map((t) => formatAxisTime(t));
}
