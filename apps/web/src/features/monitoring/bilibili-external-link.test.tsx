import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BilibiliExternalLinkButton,
  bilibiliExternalHref,
} from '@/features/monitoring/bilibili-external-link';

describe('bilibiliExternalHref', () => {
  test('builds video / dynamic / creator urls only for valid ids', () => {
    expect(bilibiliExternalHref('video', 'BV1xx411c7mD')).toBe(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    );
    expect(bilibiliExternalHref('dynamic', '1241488471951933462')).toBe(
      'https://www.bilibili.com/opus/1241488471951933462',
    );
    expect(bilibiliExternalHref('creator', '496445222')).toBe(
      'https://space.bilibili.com/496445222',
    );
    expect(bilibiliExternalHref('video', '')).toBeNull();
    expect(bilibiliExternalHref('video', 'av123')).toBeNull();
    expect(bilibiliExternalHref('dynamic', '0')).toBeNull();
    expect(bilibiliExternalHref('creator', '0')).toBeNull();
  });
});

describe('BilibiliExternalLinkButton', () => {
  test('renders aria-label and security attrs; skips invalid id', () => {
    const html = renderToStaticMarkup(
      <BilibiliExternalLinkButton kind="video" id="BV1xx411c7mD" />,
    );
    expect(html).toContain('aria-label="在 B 站打开"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('https://www.bilibili.com/video/BV1xx411c7mD');
    expect(renderToStaticMarkup(<BilibiliExternalLinkButton kind="video" id="bad" />)).toBe('');
  });
});
