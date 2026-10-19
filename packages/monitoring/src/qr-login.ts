import type { CookieJar } from './credentials';
import { parseNav, parseQrGenerate, parseQrPoll, readBizCode } from './bilibili-parse';
import { BilibiliFailure, classifyBilibiliResponse } from './bilibili-failure';
import {
  assertAllowedCollectorHost,
  bilibiliHeaders,
  type HttpTransport,
} from './bilibili-transport';
import type { CollectorLogger } from './collector-log';
import { scrubSensitive } from './sensitive';

const GENERATE_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const POLL_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';
const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';

export type LoginProfile = {
  mid: string;
  uname: string;
  face: string | null;
  jar: CookieJar;
  cookieExpiresAt: Date | null;
};

function headerList(headers: Record<string, string[]>, name: string): string[] {
  const target = name.toLowerCase();
  for (const [key, values] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return values;
  }
  return [];
}

export function parseSetCookie(headers: Record<string, string[]>): {
  jar: CookieJar;
  expiresAt: Date | null;
} {
  const jar: CookieJar = {};
  let expiresAt: Date | null = null;
  for (const line of headerList(headers, 'set-cookie')) {
    const parts = line.split(';').map((part) => part.trim());
    const first = parts[0];
    if (!first) continue;
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name || !value) continue;
    jar[name] = value;
    let cookieExpires: Date | null = null;
    for (const attr of parts.slice(1)) {
      const split = attr.indexOf('=');
      const key = (split >= 0 ? attr.slice(0, split) : attr).trim().toLowerCase();
      const raw = split >= 0 ? attr.slice(split + 1).trim() : '';
      if (key === 'expires') {
        const parsed = Date.parse(raw);
        if (!Number.isNaN(parsed)) cookieExpires = new Date(parsed);
      }
      if (key === 'max-age') {
        const seconds = Number(raw);
        if (Number.isFinite(seconds)) cookieExpires = new Date(Date.now() + seconds * 1000);
      }
    }
    if (name === 'SESSDATA' && cookieExpires) expiresAt = cookieExpires;
  }
  return { jar, expiresAt };
}

async function getJson(
  transport: HttpTransport,
  url: string,
  cookie: string | null,
  endpoint: 'qr_generate' | 'qr_poll' | 'nav',
): Promise<{ payload: unknown; headers: Record<string, string[]> }> {
  assertAllowedCollectorHost(url);
  const response = await transport({
    url,
    method: 'GET',
    headers: bilibiliHeaders(cookie),
  });
  let payload: unknown;
  try {
    payload = JSON.parse(response.body) as unknown;
  } catch {
    throw new BilibiliFailure({
      message: `${endpoint} 响应不是 JSON`,
      kind: 'retryable',
      endpoint,
      statusCode: response.status,
      bizCode: null,
      calls: [],
    });
  }
  const biz = readBizCode(payload);
  const kind = classifyBilibiliResponse({
    statusCode: response.status,
    bizCode: biz.code,
    timedOut: false,
  });
  if (kind) {
    throw new BilibiliFailure({
      message: scrubSensitive(`${endpoint} 业务码 ${biz.code ?? response.status}`),
      kind,
      endpoint,
      statusCode: response.status,
      bizCode: biz.code,
      calls: [],
    });
  }
  return { payload, headers: response.headers };
}

export async function runQrLogin(options: {
  transport: HttpTransport;
  renderQr: (url: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  save: (profile: LoginProfile) => Promise<{ accountId: string }>;
  log?: (line: string) => void;
  logger?: CollectorLogger;
  pollIntervalMs?: number;
  maxPolls?: number;
}): Promise<{ accountId: string; mid: string; uname: string }> {
  const log = options.log ?? (() => undefined);
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const maxPolls = options.maxPolls ?? 90;
  const generated = await getJson(options.transport, GENERATE_URL, null, 'qr_generate');
  const qr = parseQrGenerate(generated.payload);
  await options.renderQr(qr.url);
  log('二维码已生成，请用哔哩哔哩 App 扫码');
  const pollUrl = new URL(POLL_URL);
  pollUrl.searchParams.set('qrcode_key', qr.qrcodeKey);
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    await options.sleep(pollIntervalMs);
    const polled = await getJson(options.transport, pollUrl.toString(), null, 'qr_poll');
    const state = parseQrPoll(polled.payload);
    if (state.state === 'waiting') continue;
    if (state.state === 'scanned') {
      log('已扫码，等待手机确认');
      continue;
    }
    if (state.state === 'expired') {
      throw new Error('二维码已过期');
    }
    const cookies = parseSetCookie(polled.headers);
    if (Object.keys(cookies.jar).length === 0) {
      throw new Error('登录响应没有 Set-Cookie');
    }
    const header = Object.entries(cookies.jar)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    const nav = await getJson(options.transport, NAV_URL, header, 'nav');
    const profile = parseNav(nav.payload);
    if (!profile.isLogin) throw new Error('登录态校验失败');
    const saved = await options.save({
      mid: profile.mid,
      uname: profile.uname,
      face: profile.face,
      jar: cookies.jar,
      cookieExpiresAt: cookies.expiresAt,
    });
    options.logger?.info('登录成功', {
      event: 'auth.login',
      context: { accountId: saved.accountId, mid: profile.mid },
    });
    log(`登录成功 mid=${profile.mid} uname=${profile.uname}`);
    return { accountId: saved.accountId, mid: profile.mid, uname: profile.uname };
  }
  throw new Error('二维码等待超时');
}
