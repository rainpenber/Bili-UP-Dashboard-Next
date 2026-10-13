import { describe, expect, test } from 'bun:test';
import { createHealthResponse, parseHealthResponse } from './health';

describe('health contract', () => {
  test('createHealthResponse defaults status and timestamp', () => {
    const body = createHealthResponse({ service: 'api', version: '0.0.0' });
    expect(body.status).toBe('ok');
    expect(body.service).toBe('api');
    expect(body.version).toBe('0.0.0');
    expect(() => Date.parse(body.timestamp)).not.toThrow();
  });

  test('parseHealthResponse accepts valid payload', () => {
    const payload = {
      status: 'ok' as const,
      service: 'api',
      version: '1.0.0',
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    expect(parseHealthResponse(payload)).toEqual(payload);
  });

  test('parseHealthResponse rejects invalid status', () => {
    expect(() =>
      parseHealthResponse({
        status: 'unknown',
        service: 'api',
        version: '1.0.0',
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/Invalid health status/);
  });
});
