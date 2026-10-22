import { describe, expect, it } from 'bun:test';
import { assertFileSize, MAX_UPLOAD_BYTES } from './file-limits';

describe('assertFileSize', () => {
  it('allows files within limit', () => {
    expect(() => assertFileSize({ size: 10 })).not.toThrow();
  });

  it('rejects oversized files', () => {
    expect(() => assertFileSize({ size: MAX_UPLOAD_BYTES + 1 })).toThrow(/过大/);
  });
});
