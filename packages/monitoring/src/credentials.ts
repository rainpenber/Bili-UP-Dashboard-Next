import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { scrubSensitive } from './sensitive';

export type CookieJar = Record<string, string>;

export type EncryptedCookie = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
};

const IV_BYTES = 12;

export function loadCollectorSecretKey(raw: string | undefined): Buffer | null {
  if (raw === undefined || raw.trim() === '') return null;
  const decoded = Buffer.from(raw.trim(), 'base64');
  if (decoded.length !== 32) {
    throw new Error('COLLECTOR_SECRET_KEY 必须是 32 字节的 base64');
  }
  return decoded;
}

export function assertProviderCanStart(kind: 'offline' | 'bilibili', env: NodeJS.ProcessEnv): void {
  if (kind !== 'bilibili') return;
  const key = loadCollectorSecretKey(env.COLLECTOR_SECRET_KEY);
  if (!key) {
    throw new Error('COLLECTOR_SECRET_KEY 缺失，bilibili 模式拒绝启动');
  }
}

export function readCollectorProviderKind(env: NodeJS.ProcessEnv): 'offline' | 'bilibili' {
  const raw = env.COLLECTOR_PROVIDER?.trim() || env.MONITOR_PROVIDER?.trim() || 'offline';
  if (raw === 'offline' || raw === 'mock') return 'offline';
  if (raw === 'bilibili') return 'bilibili';
  throw new Error(`采集源 ${raw} 未实现（fail closed）。不会访问 Bilibili。`);
}

export function encryptCookieJar(jar: CookieJar, key: Buffer, keyVersion = 1): EncryptedCookie {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(jar), 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion };
}

export function decryptCookieJar(payload: EncryptedCookie, key: Buffer): CookieJar {
  if (payload.keyVersion !== 1) {
    throw new Error('不支持的凭据密钥版本');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, payload.iv);
    decipher.setAuthTag(payload.authTag);
    const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
    return parseCookieJar(plaintext.toString('utf8'));
  } catch (error) {
    if (error instanceof Error && error.message === '凭据内容无效') throw error;
    if (error instanceof Error && error.message === '不支持的凭据密钥版本') throw error;
    throw new Error('凭据无法解密');
  }
}

function parseCookieJar(raw: string): CookieJar {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('凭据内容无效');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('凭据内容无效');
  }
  const jar: CookieJar = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') throw new Error('凭据内容无效');
    jar[name] = value;
  }
  return jar;
}

export function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .filter(([, value]) => value.length > 0)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/**
 * Parse a browser Cookie header string (`a=1; b=2`) into a jar.
 * Does not call the network. Mid is taken from DedeUserID when present.
 */
export function parseCookieHeaderString(raw: string): {
  jar: CookieJar;
  mid: string | null;
} {
  const jar: CookieJar = {};
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name || !value) continue;
    jar[name] = value;
  }
  const midRaw = jar.DedeUserID?.trim() ?? '';
  const mid = /^\d{1,20}$/.test(midRaw) && !midRaw.startsWith('0') ? midRaw : null;
  return { jar, mid };
}

export function isBilibiliRealAccessEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const dataSource = env.MONITOR_DATA_SOURCE?.trim() || 'mock';
  if (dataSource === 'mock') return false;
  try {
    return readCollectorProviderKind(env) === 'bilibili';
  } catch {
    return false;
  }
}

export function scrubCollectorError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return scrubSensitive(message).slice(0, 500);
}
