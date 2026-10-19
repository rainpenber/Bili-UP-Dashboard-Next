import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import {
  assertProviderCanStart,
  cookieHeader,
  decryptCookieJar,
  encryptCookieJar,
  loadCollectorSecretKey,
  readCollectorProviderKind,
} from './credentials';
import { scrubSensitive } from './sensitive';
import { clipCollectorError } from './collector-runner';

describe('collector credentials', () => {
  test('round-trips a cookie jar and never needs the network', () => {
    const key = randomBytes(32);
    const jar = { session: 'alpha', token: 'beta' };
    const encrypted = encryptCookieJar(jar, key);
    expect(encrypted.ciphertext.equals(Buffer.from(JSON.stringify(jar)))).toBe(false);
    expect(decryptCookieJar(encrypted, key)).toEqual(jar);
    expect(cookieHeader(jar)).toBe('session=alpha; token=beta');
  });

  test('offline mode starts without a key, bilibili mode does not', () => {
    expect(() => assertProviderCanStart('offline', {})).not.toThrow();
    expect(() => assertProviderCanStart('bilibili', {})).toThrow(/COLLECTOR_SECRET_KEY 缺失/);
    expect(() => loadCollectorSecretKey('aaaa')).toThrow(/32 字节/);
    const key = randomBytes(32).toString('base64');
    expect(loadCollectorSecretKey(key)?.length).toBe(32);
    expect(() => assertProviderCanStart('bilibili', { COLLECTOR_SECRET_KEY: key })).not.toThrow();
  });

  test('provider selection prefers COLLECTOR_PROVIDER and still fail-closes', () => {
    expect(readCollectorProviderKind({})).toBe('offline');
    expect(readCollectorProviderKind({ MONITOR_PROVIDER: 'offline' })).toBe('offline');
    expect(readCollectorProviderKind({ MONITOR_PROVIDER: 'mock' })).toBe('offline');
    expect(
      readCollectorProviderKind({ COLLECTOR_PROVIDER: 'bilibili', MONITOR_PROVIDER: 'offline' }),
    ).toBe('bilibili');
    expect(() => readCollectorProviderKind({ COLLECTOR_PROVIDER: 'live' })).toThrow(/fail closed/);
  });

  test('errors do not keep cookie or key material', () => {
    const raw =
      'upstream failed SESSDATA=super-secret bili_jct=csrf-value COLLECTOR_SECRET_KEY=abc';
    const scrubbed = scrubSensitive(raw);
    expect(scrubbed).not.toContain('super-secret');
    expect(scrubbed).not.toContain('csrf-value');
    expect(scrubbed).not.toContain('abc');
    expect(clipCollectorError(new Error(raw))).toBe(scrubbed.slice(0, 500));
  });
});
