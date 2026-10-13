import { describe, expect, test } from 'bun:test';
import { createApp } from './app';

describe('health', () => {
  test('GET /health', async () => {
    const app = createApp({ skipDb: true });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('GET /api/health', async () => {
    const app = createApp({ skipDb: true });
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
  });
});
