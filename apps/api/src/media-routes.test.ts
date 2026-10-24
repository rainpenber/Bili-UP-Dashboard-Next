import { describe, expect, test } from 'bun:test';
import { createMediaRoutes, resetMediaImageCacheForTests } from './media-routes';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('media image proxy', () => {
  test('rejects non-allowlisted hosts and serves cached allowlisted images', async () => {
    resetMediaImageCacheForTests();
    let hits = 0;
    const app = createMediaRoutes({
      fetchImage: async (url) => {
        hits += 1;
        return {
          status: 200,
          finalUrl: url.toString(),
          contentType: 'image/png',
          body: PNG,
        };
      },
    });

    const denied = await app.request(
      `/image?url=${encodeURIComponent('https://evil.example/a.jpg')}`,
    );
    expect(denied.status).toBe(400);

    const ok = await app.request(
      `/image?url=${encodeURIComponent('https://i0.hdslb.com/bfs/face/a.jpg')}`,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(hits).toBe(1);

    const cached = await app.request(
      `/image?url=${encodeURIComponent('https://i0.hdslb.com/bfs/face/a.jpg')}`,
    );
    expect(cached.status).toBe(200);
    expect(hits).toBe(1);
  });
});
