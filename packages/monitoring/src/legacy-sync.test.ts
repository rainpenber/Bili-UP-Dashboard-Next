import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { PrefixHasher, decodeLegacyHeader, takeCompleteLines } from './legacy-sync-bytes';
import { parseSyncBatchLines, parseSyncInterval } from './legacy-sync';

describe('legacy sync bytes', () => {
  test('keeps a trailing CR and an incomplete UTF-8 byte for the next read', () => {
    const split = takeCompleteLines(Buffer.from('a\r\nb\r'), 10);
    expect(split.done.toString('utf8')).toBe('a\r\n');
    expect(split.rest.toString('utf8')).toBe('b\r');
    const partial = Buffer.from([0xe5]);
    const utf8 = takeCompleteLines(Buffer.concat([Buffer.from('行\n'), partial]), 10);
    expect(utf8.done.toString('utf8')).toBe('行\n');
    expect(Buffer.compare(utf8.rest, partial)).toBe(0);
  });

  test('hashes only the consumed prefix and can continue', () => {
    const hasher = new PrefixHasher();
    hasher.update(Buffer.from('abc'));
    const first = hasher.snapshot();
    hasher.update(Buffer.from('def'));
    const second = hasher.snapshot();
    expect(first.prefixSha256).toBe(createHash('sha256').update('abc').digest('hex'));
    expect(second.prefixSha256).toBe(createHash('sha256').update('abcdef').digest('hex'));
    expect(first.prefixSha256).not.toBe(second.prefixSha256);
    expect(second.boundaryLength).toBe(6);
  });

  test('strips a UTF-8 BOM from the header line', () => {
    expect(decodeLegacyHeader(Buffer.from('\uFEFF时间,粉丝数\r\n', 'utf8'))).toBe('时间,粉丝数');
  });
});

describe('legacy sync cli numbers', () => {
  test('parses the default quarter-hour interval and batch bounds', () => {
    expect(parseSyncInterval('15m')).toBe(15 * 60 * 1000);
    expect(parseSyncInterval('900000')).toBe(900_000);
    expect(parseSyncBatchLines('2000')).toBe(2000);
    expect(() => parseSyncInterval('0m')).toThrow(/interval/);
    expect(() => parseSyncBatchLines('0')).toThrow(/batch-size/);
    expect(() => parseSyncBatchLines('5001')).toThrow(/batch-size/);
  });
});
