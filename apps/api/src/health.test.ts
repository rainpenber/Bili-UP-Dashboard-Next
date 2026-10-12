import { describe, expect, test } from 'bun:test';
import { parseHealthResponse } from '@studio/contracts';
import { createApp, API_VERSION, SERVICE_NAME } from './app';

describe('GET /health', () => {
  test('returns typed health JSON', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    const parsed = parseHealthResponse(json);
    expect(parsed.service).toBe(SERVICE_NAME);
    expect(parsed.version).toBe(API_VERSION);
    expect(parsed.status).toBe('ok');
  });
});
