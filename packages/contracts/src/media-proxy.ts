import { MonitorContractError } from './monitor-targets';

/** In-process proxy path for Bilibili CDN images (referer anti-leech). */
export const MEDIA_IMAGE_PROXY_PATH = '/api/v1/media/image';

const ALLOWED_HOST =
  /^(?:[a-z0-9-]+\.)*(?:hdslb\.com|bilibili\.com)$/i;

/**
 * Build a same-origin proxy URL for a raw Bilibili image URL.
 * Returns null when the raw URL is missing or not an http(s) URL.
 * The proxy still enforces host allowlist at request time.
 */
export function bilibiliMediaProxyUrl(
  rawUrl: string | null | undefined,
  opts?: { w?: number },
): string | null {
  if (rawUrl === null || rawUrl === undefined) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  let normalized = trimmed;
  if (normalized.startsWith('//')) normalized = `https:${normalized}`;
  if (normalized.startsWith('http://')) {
    normalized = `https://${normalized.slice('http://'.length)}`;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  } catch {
    return null;
  }
  const params = new URLSearchParams();
  params.set('url', normalized);
  if (opts?.w !== undefined) {
    if (!Number.isInteger(opts.w) || opts.w < 1 || opts.w > 2048) {
      throw new MonitorContractError('invalid_body', '图片宽度参数不正确');
    }
    params.set('w', String(opts.w));
  }
  return `${MEDIA_IMAGE_PROXY_PATH}?${params.toString()}`;
}

/** True when hostname is *.hdslb.com or *.bilibili.com (no IP literals). */
export function isAllowedBilibiliMediaHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host || host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  return ALLOWED_HOST.test(host);
}
