import { describe, expect, test } from 'bun:test';
import { canonicalJson } from './canonical-json';

describe('canonicalJson', () => {
  test('key order does not affect canonical equality', () => {
    const a = { z: 1, a: { y: 2, b: 3 } };
    const b = { a: { b: 3, y: 2 }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});
