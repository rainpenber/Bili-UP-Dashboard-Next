/** 与旧工具 / Python 参考一致 */
const MMSS_LINE_RE = /^\s*\[?(\d{1,2})\s*[:：]\s*(\d{1,2})\]?\s+(.+?)\s*$/;

export type DanmakuConvertMode = 'mmssToPipe' | 'pipeToSlash';

export function convertMmssToPipeLines(text: string): {
  lines: string[];
  skipped: number;
} {
  const lines: string[] = [];
  let skipped = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(MMSS_LINE_RE);
    if (!m) {
      skipped += 1;
      continue;
    }
    const minute = Number(m[1]);
    const second = Number(m[2]);
    const content = m[3]!.trim();
    const totalSeconds = minute * 60 + second;
    const secStr = String(totalSeconds).padStart(2, '0');
    lines.push(`${secStr}|${content}`);
  }

  return { lines, skipped };
}

function secondsToMmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 与旧工具秒|内容 → 内容/分:秒 一致 */
export function convertPipeToSlashLines(text: string): {
  lines: string[];
  skipped: number;
} {
  const lines: string[] = [];
  let skipped = 0;

  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/\ufeff/g, '').trim();
    if (!line) continue;

    const pipeIdx = line.indexOf('|');
    if (pipeIdx < 0) {
      skipped += 1;
      continue;
    }
    const secPart = line.slice(0, pipeIdx).trim();
    const content = line.slice(pipeIdx + 1).trim();
    if (!/^\d+$/.test(secPart) || !content) {
      skipped += 1;
      continue;
    }
    const totalSeconds = Number(secPart);
    const mmss = secondsToMmss(totalSeconds);
    lines.push(`${content}/${mmss}`);
  }

  return { lines, skipped };
}

export function convertDanmakuText(
  text: string,
  mode: DanmakuConvertMode,
): { lines: string[]; skipped: number } {
  return mode === 'mmssToPipe' ? convertMmssToPipeLines(text) : convertPipeToSlashLines(text);
}
