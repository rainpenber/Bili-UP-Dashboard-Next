/**
 * WBI 签名（固定文档 reference/bilibili-api/wbi.md）。
 * 投稿列表 `/x/space/wbi/arc/search` 必须附带 w_rid / wts。
 */

import { createHash } from 'node:crypto';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
] as const;

export function extractWbiKeysFromNav(payload: unknown): { imgKey: string; subKey: string } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('nav 响应不是对象');
  }
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('nav 缺少 data');
  }
  const wbi = (data as { wbi_img?: unknown }).wbi_img;
  if (typeof wbi !== 'object' || wbi === null || Array.isArray(wbi)) {
    throw new Error('nav 缺少 wbi_img');
  }
  const imgUrl = (wbi as { img_url?: unknown }).img_url;
  const subUrl = (wbi as { sub_url?: unknown }).sub_url;
  if (typeof imgUrl !== 'string' || typeof subUrl !== 'string') {
    throw new Error('wbi_img 缺少 url');
  }
  return {
    imgKey: filenameStem(imgUrl),
    subKey: filenameStem(subUrl),
  };
}

function filenameStem(url: string): string {
  const file = url.split('/').pop() ?? '';
  const stem = file.replace(/\.[^.]+$/, '');
  if (!stem) throw new Error('无法从 wbi url 解析 key');
  return stem;
}

export function mixinWbiKey(imgKey: string, subKey: string): string {
  const raw = `${imgKey}${subKey}`;
  let out = '';
  for (const index of MIXIN_KEY_ENC_TAB) {
    out += raw[index] ?? '';
  }
  return out.slice(0, 32);
}

export function signWbiParams(
  params: Record<string, string | number>,
  mixinKey: string,
  wts: number,
): { w_rid: string; wts: number; query: Record<string, string> } {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const raw = String(value);
    // Doc: strip "!'()*"
    filtered[key] = raw.replace(/[!'()*]/g, '');
  }
  filtered.wts = String(wts);
  const sorted = Object.keys(filtered)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(filtered[key]!)}`)
    .join('&');
  const w_rid = createHash('md5').update(`${sorted}${mixinKey}`).digest('hex');
  return {
    w_rid,
    wts,
    query: { ...filtered, w_rid },
  };
}

export function encodeSignedQuery(query: Record<string, string>): string {
  return Object.entries(query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}
