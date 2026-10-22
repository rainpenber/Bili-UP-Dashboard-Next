export type { SubtitleCue } from './types';
export { parseSrt } from './parseSrt';
export { parseAss } from './parseAss';
export { cuesToCsv, escapeCsvField } from './csv';
export { parseSrtTimestamp, parseAssTimestamp } from './time';

import { parseAss } from './parseAss';
import { parseSrt } from './parseSrt';
import type { SubtitleCue } from './types';

export function detectSubtitleFormat(filename: string, content: string): 'srt' | 'ass' {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.srt')) return 'srt';
  if (lower.endsWith('.ass') || lower.endsWith('.ssa')) return 'ass';
  if (content.includes('[Events]') && /^\s*Dialogue:/im.test(content)) {
    return 'ass';
  }
  return 'srt';
}

export function parseSubtitleFile(filename: string, content: string): SubtitleCue[] {
  const fmt = detectSubtitleFormat(filename, content);
  return fmt === 'ass' ? parseAss(content) : parseSrt(content);
}

export function isSubtitleFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.srt') || lower.endsWith('.ass') || lower.endsWith('.ssa');
}
