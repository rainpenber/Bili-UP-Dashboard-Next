import { describe, expect, test } from 'bun:test';
import { bilibiliMediaProxyUrl, isAllowedBilibiliMediaHost, MEDIA_IMAGE_PROXY_PATH } from './media-proxy';

describe('bilibiliMediaProxyUrl', () => {
  test('builds proxy path with encoded url', () => {
    const raw = 'https://i0.hdslb.com/bfs/face/a.jpg';
    expect(bilibiliMediaProxyUrl(raw)).toBe(
      `${MEDIA_IMAGE_PROXY_PATH}?url=${encodeURIComponent(raw)}`,
    );
    expect(bilibiliMediaProxyUrl(raw, { w: 120 })).toContain('w=120');
  });

  test('normalizes protocol-relative and http', () => {
    expect(bilibiliMediaProxyUrl('//i0.hdslb.com/a.jpg')).toContain(
      encodeURIComponent('https://i0.hdslb.com/a.jpg'),
    );
    expect(bilibiliMediaProxyUrl('http://i0.hdslb.com/a.jpg')).toContain(
      encodeURIComponent('https://i0.hdslb.com/a.jpg'),
    );
  });

  test('returns null for empty', () => {
    expect(bilibiliMediaProxyUrl(null)).toBeNull();
    expect(bilibiliMediaProxyUrl('')).toBeNull();
    expect(bilibiliMediaProxyUrl('   ')).toBeNull();
  });
});

describe('isAllowedBilibiliMediaHost', () => {
  test('allows hdslb and bilibili subdomains', () => {
    expect(isAllowedBilibiliMediaHost('i0.hdslb.com')).toBe(true);
    expect(isAllowedBilibiliMediaHost('hdslb.com')).toBe(true);
    expect(isAllowedBilibiliMediaHost('www.bilibili.com')).toBe(true);
  });

  test('rejects other hosts and IP literals', () => {
    expect(isAllowedBilibiliMediaHost('evil.com')).toBe(false);
    expect(isAllowedBilibiliMediaHost('127.0.0.1')).toBe(false);
    expect(isAllowedBilibiliMediaHost('localhost')).toBe(false);
    expect(isAllowedBilibiliMediaHost('hdslb.com.evil.com')).toBe(false);
  });
});
