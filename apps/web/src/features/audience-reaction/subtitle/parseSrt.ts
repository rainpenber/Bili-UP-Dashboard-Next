import type { SubtitleCue } from './types';
import { parseSrtTimestamp } from './time';

/**
 * 解析 SRT 全文。忽略 BOM；合并同一 cue 内多行文本为换行连接。
 */
export function parseSrt(content: string): SubtitleCue[] {
  const text = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const blocks = text
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 2) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0]!.trim())) i = 1;
    const timeLine = lines[i];
    if (!timeLine) continue;
    const tm = timeLine.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
    if (!tm) continue;
    const startSec = parseSrtTimestamp(tm[1]!);
    const endSec = parseSrtTimestamp(tm[2]!);
    const textLines = lines.slice(i + 1);
    const cueText = textLines
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (cueText) cues.push({ startSec, endSec, text: cueText });
  }

  return cues;
}
