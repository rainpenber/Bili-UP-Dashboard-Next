const TZ = 'Asia/Shanghai';

function shanghaiDateParts(instant: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  return {
    y: Number(parts.find((p) => p.type === 'year')?.value),
    m: Number(parts.find((p) => p.type === 'month')?.value),
    d: Number(parts.find((p) => p.type === 'day')?.value),
  };
}

/** Inclusive start / exclusive end of the calendar day in Asia/Shanghai for `instant`. */
export function shanghaiDayBounds(instant: Date): { start: Date; end: Date; endPlus7: Date } {
  const { y, m, d } = shanghaiDateParts(instant);
  const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const start = new Date(`${dateKey}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 86_400_000);
  const endPlus7 = new Date(end.getTime() + 7 * 86_400_000);
  return { start, end, endPlus7 };
}
