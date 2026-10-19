import { describe, expect, test } from 'bun:test';
import {
  ImageReject,
  MAX_IMAGE_BYTES,
  assertHdslbUrl,
  downloadHdslbImage,
  sniffImage,
  type BinaryTransport,
} from './image-asset';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function transport(
  body: Uint8Array,
  headers: Record<string, string>,
  finalUrl: string,
): BinaryTransport {
  return async () => ({ status: 200, headers, body, finalUrl });
}

describe('hdslb image policy', () => {
  test('rejects http, a non-hdslb host, an oversized body, and gif', async () => {
    expect(() => assertHdslbUrl('http://i0.hdslb.com/a.jpg')).toThrow(ImageReject);
    expect(() => assertHdslbUrl('https://example.com/a.jpg')).toThrow(ImageReject);
    await expect(
      downloadHdslbImage('http://i0.hdslb.com/a.jpg', async () => {
        throw new Error('transport should not run');
      }),
    ).rejects.toMatchObject({ reason: 'scheme' });
    await expect(
      downloadHdslbImage('https://example.com/a.jpg', async () => {
        throw new Error('transport should not run');
      }),
    ).rejects.toMatchObject({ reason: 'host' });
    await expect(
      downloadHdslbImage(
        'https://i0.hdslb.com/a.jpg',
        transport(
          PNG_1X1,
          { 'content-length': String(MAX_IMAGE_BYTES + 1) },
          'https://i0.hdslb.com/a.jpg',
        ),
      ),
    ).rejects.toMatchObject({ reason: 'size' });
    await expect(
      downloadHdslbImage(
        'https://i0.hdslb.com/a.jpg',
        transport(PNG_1X1, { 'content-type': 'image/gif' }, 'https://i0.hdslb.com/a.jpg'),
      ),
    ).rejects.toMatchObject({ reason: 'type' });
    await expect(
      downloadHdslbImage(
        'https://i0.hdslb.com/a.jpg',
        transport(Buffer.from('GIF89a'), {}, 'https://i0.hdslb.com/a.jpg'),
      ),
    ).rejects.toMatchObject({ reason: 'type' });
    await expect(
      downloadHdslbImage(
        'https://i0.hdslb.com/a.jpg',
        transport(PNG_1X1, {}, 'https://evil.example/a.jpg'),
      ),
    ).rejects.toMatchObject({ reason: 'host' });
  });

  test('reads a 1x1 png without inventing dimensions', () => {
    const sniffed = sniffImage(PNG_1X1);
    expect(sniffed).toEqual({ mime: 'image/png', width: 1, height: 1 });
  });
});
