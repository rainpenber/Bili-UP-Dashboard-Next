import type { SubtitleCue } from './types';

/** RFC 4180 风格字段转义 */
export function escapeCsvField(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * 将字幕转为 CSV。默认含表头 `time_sec,text`，时间为 cue 的开始时间（秒）。
 */
export function cuesToCsv(cues: SubtitleCue[], options: { includeHeader?: boolean } = {}): string {
  const { includeHeader = true } = options;
  const lines: string[] = [];
  if (includeHeader) {
    lines.push('time_sec,text');
  }
  for (const c of cues) {
    const sec = String(Math.round(c.startSec * 1000) / 1000);
    lines.push(`${escapeCsvField(sec)},${escapeCsvField(c.text)}`);
  }
  return lines.join('\r\n');
}
