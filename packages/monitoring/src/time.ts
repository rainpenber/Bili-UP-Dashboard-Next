export function parseHistoricalTime(
  raw: string,
  sourceTimezone: string,
  precision: 'minute' | 'second',
): Date | null {
  void precision;
  const trimmed = raw.trim().replace(/\//g, '-');
  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const hasSeconds = /:\d{2}:\d{2}/.test(normalized);
  const isoLocal = hasSeconds ? normalized : `${normalized}:00`;

  const m = isoLocal.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);

  const utcGuess = Date.UTC(y, mo, d, h, mi, s);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: sourceTimezone,
    timeZoneName: 'longOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(new Date(utcGuess));
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const offsetMatch = tzName.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!offsetMatch) {
    return new Date(utcGuess);
  }
  const sign = offsetMatch[1]?.startsWith('-') ? -1 : 1;
  const oh = Math.abs(Number(offsetMatch[1]));
  const om = Number(offsetMatch[2] ?? '0');
  const offsetMinutes = sign * (oh * 60 + om);
  return new Date(utcGuess - offsetMinutes * 60_000);
}

export function detectTimestampPrecision(raw: string): 'minute' | 'second' {
  return /:\d{2}:\d{2}/.test(raw.trim()) ? 'second' : 'minute';
}
