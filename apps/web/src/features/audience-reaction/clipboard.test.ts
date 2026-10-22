import { describe, expect, it, mock } from 'bun:test';
import { copyTextToClipboard } from './clipboard';

describe('copyTextToClipboard', () => {
  it('returns true when Clipboard API succeeds', async () => {
    const writeText = mock(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await expect(copyTextToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back and reports failure when both paths fail', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mock(async () => {
          throw new Error('denied');
        }),
      },
    });
    const original = document.execCommand;
    document.execCommand = () => {
      throw new Error('no exec');
    };
    try {
      await expect(copyTextToClipboard('x')).resolves.toBe(false);
    } finally {
      document.execCommand = original;
    }
  });
});
