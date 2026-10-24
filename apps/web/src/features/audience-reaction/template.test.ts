import { describe, expect, it } from 'bun:test';
import {
  INTERNAL_SIMULATION_NOTICE,
  applyTemplate,
  buildSubtitleCsv,
  composePrompt,
} from './template';
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

describe('composePrompt', () => {
  it('prefixes internal-simulation notice without rewriting template body', () => {
    const body = applyTemplate(COMMENT_TEMPLATE, {
      product: 'P',
      category: 'C',
      positioning: 'Pos',
      reference_comments: 'r',
      subtitle_csv: 'time_sec,text',
    });
    const composed = composePrompt(COMMENT_TEMPLATE, {
      product: 'P',
      category: 'C',
      positioning: 'Pos',
      reference_comments: 'r',
      subtitle_csv: 'time_sec,text',
    });
    expect(composed.startsWith(INTERNAL_SIMULATION_NOTICE)).toBe(true);
    expect(composed.endsWith(body)).toBe(true);
    expect(/内部模拟|非真实|不是真实/.test(composed)).toBe(true);
    expect(COMMENT_TEMPLATE).not.toContain('【内部评估说明】');
    expect(DANMAKU_TEMPLATE).not.toContain('【内部评估说明】');
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
