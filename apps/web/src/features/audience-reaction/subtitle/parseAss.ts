import type { SubtitleCue } from './types';
import { parseAssTimestamp } from './time';

/** 去掉 ASS 内联样式标签，保留可读文本 */
export function stripAssTags(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();
}

/**
 * 解析 ASS：仅处理 [Events] 下 `Dialogue:` 行；按逗号前 9 个字段切分，余下为文本。
 */
export function parseAss(content: string): SubtitleCue[] {
  const text = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lines = text.split('\n');
  const cues: SubtitleCue[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!/^Dialogue:/i.test(line)) continue;
    const after = line.replace(/^Dialogue:\s*/i, '');
    const parts = splitAssDialogueFields(after);
    if (parts.length < 10) continue;
    const startRaw = parts[1]!;
    const endRaw = parts[2]!;
    const textField = parts.slice(9).join(',');
    try {
      const startSec = parseAssTimestamp(startRaw);
      const endSec = parseAssTimestamp(endRaw);
      const t = stripAssTags(textField);
      if (t) cues.push({ startSec, endSec, text: t });
    } catch {
      /* skip malformed */
    }
  }

  return cues;
}

/** Dialogue 行在「文本」段可能含逗号：前 9 个逗号分隔 10 个字段，余下整体为文本 */
function splitAssDialogueFields(afterDialogue: string): string[] {
  const fields: string[] = [];
  let pos = 0;
  for (let n = 0; n < 9; n++) {
    const next = afterDialogue.indexOf(',', pos);
    if (next === -1) return [];
    fields.push(afterDialogue.slice(pos, next));
    pos = next + 1;
  }
  fields.push(afterDialogue.slice(pos));
  return fields;
}
