import { scrubSensitive } from './sensitive';

export const BILIBILI_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const BILIBILI_REFERER = 'https://www.bilibili.com/';

const ALLOWED_HOSTS = new Set(['api.bilibili.com', 'passport.bilibili.com']);

export type TransportRequest = {
  url: string;
  method: 'GET';
  headers: Record<string, string>;
};

export type TransportResponse = {
  status: number;
  body: string;
  headers: Record<string, string[]>;
  durationMs: number;
};

export type HttpTransport = (request: TransportRequest) => Promise<TransportResponse>;

export class TransportFailure extends Error {
  readonly timedOut: boolean;

  constructor(message: string, timedOut: boolean) {
    super(scrubSensitive(message));
    this.name = 'TransportFailure';
    this.timedOut = timedOut;
  }
}

export function assertAllowedCollectorHost(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`采集地址不合法: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`采集只允许 HTTPS: ${parsed.hostname}`);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`采集网络守卫拒绝主机: ${parsed.hostname}`);
  }
}

export function guardTransport(inner: HttpTransport): HttpTransport {
  return async (request) => {
    assertAllowedCollectorHost(request.url);
    return inner(request);
  };
}

export function bilibiliHeaders(cookieHeader: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': BILIBILI_USER_AGENT,
    Referer: BILIBILI_REFERER,
  };
  if (cookieHeader && cookieHeader.length > 0) headers.Cookie = cookieHeader;
  return headers;
}

export function createLiveBilibiliTransport(timeoutMs: number): HttpTransport {
  return guardTransport(async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await fetch(request.url, {
        method: 'GET',
        headers: request.headers,
        signal: controller.signal,
      });
      const body = await response.text();
      const headers: Record<string, string[]> = {};
      const withSetCookie = response.headers as Headers & { getSetCookie?: () => string[] };
      const setCookies =
        typeof withSetCookie.getSetCookie === 'function' ? withSetCookie.getSetCookie() : [];
      if (setCookies.length > 0) headers['set-cookie'] = setCookies;
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie' && setCookies.length > 0) return;
        const bucket = headers[key] ?? [];
        bucket.push(value);
        headers[key] = bucket;
      });
      return {
        status: response.status,
        body,
        headers,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      const message = timedOut ? '上游请求超时' : '上游网络失败';
      throw new TransportFailure(message, timedOut);
    } finally {
      clearTimeout(timer);
    }
  });
}
