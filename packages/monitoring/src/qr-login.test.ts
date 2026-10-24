import { describe, expect, test } from 'bun:test';
import { runQrLogin, type LoginProfile } from './qr-login';
import type { HttpTransport } from './bilibili-transport';

describe('qr login', () => {
  test('polls until confirmation, verifies nav, and does not log the cookie', async () => {
    const calls: string[] = [];
    let polls = 0;
    const transport: HttpTransport = async (request) => {
      calls.push(request.url);
      if (request.url.includes('qrcode/generate')) {
        return {
          status: 200,
          body: JSON.stringify({
            code: 0,
            data: {
              url: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=fixturekey',
              qrcode_key: 'fixturekey',
            },
          }),
          headers: {},
          durationMs: 1,
        };
      }
      if (request.url.includes('qrcode/poll')) {
        polls += 1;
        const code = polls === 1 ? 86101 : 0;
        return {
          status: 200,
          body: JSON.stringify({
            code: 0,
            data: { code, message: code === 0 ? '' : '未扫码', url: '' },
          }),
          headers:
            code === 0
              ? {
                  'set-cookie': [
                    'SESSDATA=fixture-token; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
                    'bili_jct=fixture-csrf; Path=/',
                    'DedeUserID=42; Path=/',
                  ],
                }
              : {},
          durationMs: 1,
        };
      }
      expect(request.headers.Cookie).toContain('SESSDATA=fixture-token');
      return {
        status: 200,
        body: JSON.stringify({
          code: 0,
          data: { isLogin: true, mid: 42, uname: '示例', face: 'https://i0.hdslb.com/face.jpg' },
        }),
        headers: {},
        durationMs: 1,
      };
    };
    const logs: string[] = [];
    const saved: { profile: LoginProfile | null } = { profile: null };
    const result = await runQrLogin({
      transport,
      renderQr: async (url) => {
        expect(url).toContain('qrcode_key=fixturekey');
      },
      sleep: async () => undefined,
      log: (line) => logs.push(line),
      pollIntervalMs: 0,
      maxPolls: 5,
      save: async (profile) => {
        saved.profile = profile;
        return { accountId: 'acc-1' };
      },
    });
    expect(result).toEqual({ accountId: 'acc-1', mid: '42', uname: '示例' });
    expect(saved.profile?.jar.SESSDATA).toBe('fixture-token');
    expect(saved.profile?.cookieExpiresAt?.toISOString()).toBe('2026-10-21T07:28:00.000Z');
    expect(calls.some((url) => url.includes('example.com'))).toBe(false);
    const logged = logs.join('\n');
    expect(logged).not.toContain('fixture-token');
    expect(logged).not.toContain('fixture-csrf');
    expect(logged).not.toContain('fixturekey');
    expect(logged).toContain('登录成功');
  });

  test('stops when the qr code expires', async () => {
    const transport: HttpTransport = async (request) => {
      if (request.url.includes('generate')) {
        return {
          status: 200,
          body: JSON.stringify({
            code: 0,
            data: { url: 'https://passport.bilibili.com/scan', qrcode_key: 'k' },
          }),
          headers: {},
          durationMs: 1,
        };
      }
      return {
        status: 200,
        body: JSON.stringify({ code: 0, data: { code: 86038, message: '二维码已失效' } }),
        headers: {},
        durationMs: 1,
      };
    };
    await expect(
      runQrLogin({
        transport,
        renderQr: async () => undefined,
        sleep: async () => undefined,
        pollIntervalMs: 0,
        maxPolls: 2,
        save: async () => {
          throw new Error('should not save');
        },
      }),
    ).rejects.toThrow(/二维码已过期/);
  });
});
