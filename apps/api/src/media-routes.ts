import { isAllowedBilibiliMediaHost } from '@studio/contracts';
import { Hono } from 'hono';
import { httpsUrl, ImageReject, MAX_IMAGE_BYTES } from '@studio/monitoring';

const PROXY_CACHE_CONTROL = 'public, max-age=86400';
const FETCH_TIMEOUT_MS = 10_000;
const LRU_CAPACITY = 200;

export type MediaImageFetch = (url: URL) => Promise<{
  status: number;
  finalUrl: string;
  contentType: string | null;
  body: Uint8Array;
}>;

type CacheEntry = {
  bytes: Uint8Array;
  contentType: string;
  etag: string;
};

class ImageLruCache {
  private readonly map = new Map<string, CacheEntry>();
  constructor(private readonly capacity: number) {}

  get(key: string): CacheEntry | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  set(key: string, value: CacheEntry): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

const cache = new ImageLruCache(LRU_CAPACITY);

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.endsWith('.internal') || host.endsWith('.lan')) return true;
  // Literal IPv4
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return true; // reject all raw IPs
  }
  if (host.includes(':')) return true; // IPv6 / zone
  return false;
}

function assertProxyUrl(raw: string): URL {
  let normalized = raw.trim();
  if (!normalized) throw new ImageReject('scheme', '缺少图片地址');
  if (normalized.startsWith('//')) normalized = `https:${normalized}`;
  if (normalized.startsWith('http://')) {
    normalized = `https://${normalized.slice('http://'.length)}`;
  }
  let url: URL;
  try {
    url = new URL(httpsUrl(normalized));
  } catch {
    throw new ImageReject('scheme', '图片地址不合法');
  }
  if (url.protocol !== 'https:') throw new ImageReject('scheme', '图片只允许 HTTPS');
  if (isPrivateOrLocalHostname(url.hostname)) {
    throw new ImageReject('host', '拒绝内网或本地地址');
  }
  if (!isAllowedBilibiliMediaHost(url.hostname)) {
    throw new ImageReject('host', '图片域名不在白名单');
  }
  return url;
}

async function defaultMediaFetch(url: URL): Promise<{
  status: number;
  finalUrl: string;
  contentType: string | null;
  body: Uint8Array;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.bilibili.com/',
        Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*',
      },
    });
    const buffer = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get('content-type'),
      body: buffer,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUpstream(url: URL, fetchImpl: MediaImageFetch): Promise<CacheEntry> {
  try {
    const response = await fetchImpl(url);
    if (response.status !== 200) {
      throw new ImageReject('status', `图片响应状态 ${response.status}`);
    }
    const finalUrl = new URL(response.finalUrl);
    if (
      isPrivateOrLocalHostname(finalUrl.hostname) ||
      !isAllowedBilibiliMediaHost(finalUrl.hostname)
    ) {
      throw new ImageReject('host', '重定向目标不在白名单');
    }
    if (response.body.byteLength > MAX_IMAGE_BYTES) {
      throw new ImageReject('size', '图片超过大小限制');
    }
    const contentType = response.contentType?.split(';')[0]?.trim() || 'application/octet-stream';
    if (contentType === 'image/gif') throw new ImageReject('type', '拒绝 GIF');
    const etag = `"${Buffer.from(`${url.toString()}:${response.body.byteLength}:${contentType}`)
      .toString('base64url')
      .slice(0, 32)}"`;
    return { bytes: response.body, contentType, etag };
  } catch (error) {
    if (error instanceof ImageReject) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ImageReject('timeout', '图片拉取超时');
    }
    throw new ImageReject(
      'status',
      error instanceof Error ? error.message.slice(0, 200) : '图片拉取失败',
    );
  }
}

/** Test hook: clear LRU between tests. */
export function resetMediaImageCacheForTests(): void {
  // Recreate by draining via capacity-0 pattern — replace module-level by reassign is hard;
  // instead delete all keys.
  const anyCache = cache as unknown as { map: Map<string, CacheEntry> };
  anyCache.map.clear();
}

export function createMediaRoutes(options: { fetchImage?: MediaImageFetch } = {}): Hono {
  const app = new Hono();
  const fetchImpl = options.fetchImage ?? defaultMediaFetch;

  app.get('/image', async (c) => {
    const raw = c.req.query('url');
    if (!raw) {
      return c.json({ error: '缺少 url 参数', code: 'invalid_url' }, 400);
    }
    let url: URL;
    try {
      url = assertProxyUrl(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : '非法图片地址';
      return c.json({ error: message, code: 'invalid_url' }, 400);
    }

    const cacheKey = url.toString();
    let entry = cache.get(cacheKey);
    if (!entry) {
      try {
        entry = await fetchUpstream(url, fetchImpl);
        cache.set(cacheKey, entry);
      } catch (error) {
        const message = error instanceof Error ? error.message : '图片拉取失败';
        const code =
          error instanceof ImageReject && error.reason === 'timeout'
            ? 'upstream_timeout'
            : 'upstream';
        return c.json({ error: message, code }, 502);
      }
    }

    const ifNoneMatch = c.req.header('if-none-match');
    if (ifNoneMatch && ifNoneMatch.split(',').some((p) => p.trim() === entry!.etag)) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: entry.etag,
          'Cache-Control': PROXY_CACHE_CONTROL,
        },
      });
    }

    return new Response(Buffer.from(entry.bytes), {
      status: 200,
      headers: {
        'Content-Type': entry.contentType,
        'Content-Length': String(entry.bytes.byteLength),
        'Cache-Control': PROXY_CACHE_CONTROL,
        ETag: entry.etag,
      },
    });
  });

  return app;
}
