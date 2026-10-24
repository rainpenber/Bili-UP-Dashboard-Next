import { describe, expect, test } from 'bun:test';
import {
  assertAllowedCollectorHost,
  guardTransport,
  type HttpTransport,
} from './bilibili-transport';

describe('collector network guard', () => {
  test('allows only the api and passport hosts', () => {
    expect(() =>
      assertAllowedCollectorHost('https://api.bilibili.com/x/web-interface/view'),
    ).not.toThrow();
    expect(() =>
      assertAllowedCollectorHost(
        'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
      ),
    ).not.toThrow();
    expect(() => assertAllowedCollectorHost('https://www.bilibili.com/')).toThrow(/拒绝主机/);
    expect(() => assertAllowedCollectorHost('https://example.com/x')).toThrow(/拒绝主机/);
    expect(() => assertAllowedCollectorHost('https://api.bilibili.com.evil.com/x')).toThrow(
      /拒绝主机/,
    );
    expect(() => assertAllowedCollectorHost('http://api.bilibili.com/x')).toThrow(/HTTPS/);
    expect(() => assertAllowedCollectorHost('https://i0.hdslb.com/bfs/archive/a.jpg')).toThrow(
      /拒绝主机/,
    );
  });

  test('does not call the inner transport for a rejected host', async () => {
    let called = false;
    const inner: HttpTransport = async () => {
      called = true;
      throw new Error('should not run');
    };
    const guarded = guardTransport(inner);
    await expect(
      guarded({ url: 'https://example.com/secret', method: 'GET', headers: {} }),
    ).rejects.toThrow(/拒绝主机/);
    expect(called).toBe(false);
  });
});
