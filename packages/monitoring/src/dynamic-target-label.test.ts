import { describe, expect, test } from 'bun:test';
import { formatDynamicTargetLabel } from './dynamic-target-label';

describe('formatDynamicTargetLabel', () => {
  test('empty text falls back to 动态 + last 6 of id', () => {
    expect(formatDynamicTargetLabel({ text: null, dynamicId: '966692349750018048' })).toBe(
      '动态 018048',
    );
    expect(formatDynamicTargetLabel({ text: '   ', dynamicId: '123456' })).toBe('动态 123456');
    expect(formatDynamicTargetLabel({ text: '', dynamicId: '42' })).toBe('动态 42');
  });

  test('collapses newlines and extra spaces', () => {
    expect(
      formatDynamicTargetLabel({
        text: '今天  发了\n一条\t动态',
        dynamicId: '1',
      }),
    ).toBe('今天 发了 一条 动态');
  });

  test('truncates over 24 chars with ellipsis', () => {
    const long = '一二三四五六七八九十一二三四五六七八九十一二三四五';
    expect(long.length).toBeGreaterThan(24);
    expect(formatDynamicTargetLabel({ text: long, dynamicId: '9' })).toBe(`${long.slice(0, 24)}…`);
  });

  test('keeps short custom text as-is', () => {
    expect(formatDynamicTargetLabel({ text: '自定义标题', dynamicId: '1' })).toBe('自定义标题');
  });
});
