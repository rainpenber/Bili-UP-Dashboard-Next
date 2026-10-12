import { describe, expect, test } from 'bun:test';
import { parseBoundedCount, parseCsv } from './csv-parse';

describe('parseCsv', () => {
  test('strips BOM and parses CRLF', () => {
    const text = '\uFEFFa,b\r\n1,2\r\n';
    const parsed = parseCsv(text);
    expect(parsed.headers).toEqual(['a', 'b']);
    expect(parsed.rows).toEqual([['1', '2']]);
  });

  test('supports quoted newline', () => {
    const text = 'a,b\n"line1\nline2",3\n';
    const parsed = parseCsv(text);
    expect(parsed.rows[0]?.[0]).toBe('line1\nline2');
  });
});

describe('parseBoundedCount', () => {
  test('parses 1000+ lower bound', () => {
    const r = parseBoundedCount('1000+');
    expect(r.value).toBe(1000n);
    expect(r.raw).toBe('1000+');
    expect(r.note).toBe('lower_bound');
  });

  test('keeps zero as zero', () => {
    const r = parseBoundedCount('0');
    expect(r.value).toBe(0n);
  });
});
