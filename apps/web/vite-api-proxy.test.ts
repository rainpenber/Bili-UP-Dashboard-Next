import { describe, expect, test } from 'bun:test';
import { resolveApiProxyTarget } from './vite-api-proxy';

describe('Vite /api proxy target', () => {
  test('defaults to local API for bare-metal dev', () => {
    expect(resolveApiProxyTarget({})).toBe('http://localhost:3000');
  });

  test('uses VITE_API_PROXY_TARGET when set (Compose web → api service)', () => {
    expect(resolveApiProxyTarget({ VITE_API_PROXY_TARGET: 'http://api:3000' })).toBe(
      'http://api:3000',
    );
  });

  test('strips trailing slash', () => {
    expect(resolveApiProxyTarget({ VITE_API_PROXY_TARGET: 'http://api:3000/' })).toBe(
      'http://api:3000',
    );
  });
});
