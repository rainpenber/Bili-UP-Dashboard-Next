import { describe, expect, test } from 'bun:test';
import { mapHttpModeToImportMode, parseImportCsvRequest } from './imports';

describe('imports contract', () => {
  test('parses dry-run request', () => {
    const req = parseImportCsvRequest({ mode: 'dry-run', sourceTimezone: 'Asia/Shanghai' });
    expect(req.mode).toBe('dry-run');
    expect(mapHttpModeToImportMode(req.mode)).toBe('dry_run');
  });

  test('rejects invalid mode', () => {
    expect(() => parseImportCsvRequest({ mode: 'inventory' })).toThrow(/mode must/);
  });
});
