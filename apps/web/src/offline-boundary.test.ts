import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('offline web boundary', () => {
  test('index.html does not request Google Fonts or bilibili', () => {
    const html = readFileSync(join(import.meta.dir, '../index.html'), 'utf8');
    expect(html).not.toMatch(/fonts\.googleapis\.com/i);
    expect(html).not.toMatch(/bilibili/i);
  });
});
