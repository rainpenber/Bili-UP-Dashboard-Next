/** SRT: 00:00:01,234 或 00:01:01,234 */
export function parseSrtTimestamp(s: string): number {
  const t = s.trim();
  const m = t.match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!m) throw new Error(`无效的 SRT 时间: ${s}`);
  const [, hh, mm, ss, ms] = m;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
}

/** ASS: 0:00:01.23 或 0:01:01.23 */
export function parseAssTimestamp(s: string): number {
  const t = s.trim();
  const m = t.match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!m) throw new Error(`无效的 ASS 时间: ${s}`);
  const [, h, mm, ss, cs] = m;
  return Number(h) * 3600 + Number(mm) * 60 + Number(ss) + Number(cs) / 100;
}
