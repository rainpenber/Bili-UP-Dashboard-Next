import { describe, expect, it } from 'bun:test';
import { applyTemplate, buildSubtitleCsv } from './template';
import { COMMENT_TEMPLATE, DANMAKU_TEMPLATE, getTemplateRaw } from './templates';

describe('applyTemplate', () => {
  it('interpolates known placeholders and leaves missing empty', () => {
    expect(applyTemplate('A={{product}} B={{missing}}', { product: 'P' })).toBe('A=P B=');
  });

  it('does not interpret HTML in values', () => {
    const out = applyTemplate('x={{product}}', { product: '<b>bold</b>' });
    expect(out).toBe('x=<b>bold</b>');
  });
});

describe('legacy templates', () => {
  it('keeps required placeholders for comment and danmaku', () => {
    for (const tpl of [COMMENT_TEMPLATE, DANMAKU_TEMPLATE]) {
      expect(tpl).toContain('{{product}}');
      expect(tpl).toContain('{{category}}');
      expect(tpl).toContain('{{positioning}}');
      expect(tpl).toContain('{{reference_comments}}');
      expect(tpl).toContain('{{subtitle_csv}}');
    }
  });

  it('switches templates synchronously without race', () => {
    expect(getTemplateRaw('comment')).toBe(COMMENT_TEMPLATE);
    expect(getTemplateRaw('danmaku')).toBe(DANMAKU_TEMPLATE);
    expect(getTemplateRaw('comment')).not.toBe(getTemplateRaw('danmaku'));
  });

  it('buildSubtitleCsv includes header', () => {
    const csv = buildSubtitleCsv([{ startSec: 1, endSec: 2, text: 'hi' }]);
    expect(csv.startsWith('time_sec,text')).toBe(true);
    expect(csv).toContain('1,hi');
  });
});
