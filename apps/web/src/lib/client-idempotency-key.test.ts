import { describe, expect, test } from 'bun:test';
import { createClientIdempotencyKey } from './client-idempotency-key';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('createClientIdempotencyKey', () => {
  test('uses crypto.randomUUID when present', () => {
    const key = createClientIdempotencyKey({
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
      getRandomValues: () => {
        throw new Error('getRandomValues should not run');
      },
    });
    expect(key).toBe('11111111-2222-4333-8444-555555555555');
  });

  test('builds a UUID v4 from getRandomValues when randomUUID is missing', () => {
    const key = createClientIdempotencyKey({
      getRandomValues: (array) => {
        const view = array as Uint8Array;
        for (let i = 0; i < view.length; i += 1) view[i] = i;
        return array;
      },
    });
    expect(key).toMatch(UUID_V4);
    expect(key).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  test('falls back without crypto and still returns unique UUID-shaped keys', () => {
    const a = createClientIdempotencyKey(undefined);
    const b = createClientIdempotencyKey({});
    expect(a).toMatch(UUID_V4);
    expect(b).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });
});
