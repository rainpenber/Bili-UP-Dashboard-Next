import { describe, expect, test } from 'bun:test';
import { createLogger } from '@studio/observability';
import { createApp } from './app';

describe('request logging', () => {
  test('echoes x-request-id and keeps it on the http.request line without headers', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: 'api',
      instance: 'test',
      level: 'info',
      destination: (line) => lines.push(line),
      sink: null,
    });
    const app = createApp({ skipDb: true, logger });
    app.get('/boom', () => {
      throw new Error('SESSDATA=plain-sess-value-9f3a; bili_jct=plain-jct-value-9f3a');
    });
    const ok = await app.request('/health', {
      headers: {
        'x-request-id': 'req-fixed-1',
        cookie: 'SESSDATA=plain-sess-value-9f3a',
        authorization: 'Bearer abc.def-GHI_9',
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-request-id')).toBe('req-fixed-1');
    const requestLine = lines.find((line) => line.includes('http.request'));
    expect(requestLine).toBeTruthy();
    expect(requestLine).toContain('req-fixed-1');
    expect(requestLine).toContain('"path":"/health"');
    expect(lines.join('\n')).not.toContain('plain-sess-value-9f3a');
    expect(lines.join('\n')).not.toContain('abc.def-GHI_9');

    const generated = await app.request('/health');
    const generatedId = generated.headers.get('x-request-id');
    expect(generatedId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(
      lines.some(
        (line) =>
          generatedId !== null && line.includes(generatedId) && line.includes('http.request'),
      ),
    ).toBe(true);

    const failed = await app.request('/boom', { headers: { 'x-request-id': 'req-boom' } });
    expect(failed.status).toBe(500);
    expect(failed.headers.get('x-request-id')).toBe('req-boom');
    const errorLine = lines.find(
      (line) => line.includes('http.error') && line.includes('req-boom'),
    );
    expect(errorLine).toBeTruthy();
    expect(errorLine).not.toContain('plain-sess-value-9f3a');
    expect(errorLine).not.toContain('plain-jct-value-9f3a');
  });
});
