import { describe, expect, test } from 'bun:test';
import {
  formatCompactNumber,
  formatExactNumber,
  formatOnlineViewersDisplay,
  formatUnknownMetric,
  formatViewCountDisplay,
} from '@/lib/format-compact-number';

describe('formatCompactNumber', () => {
  test('formats 万 and 亿', () => {
    expect(formatCompactNumber(12_345)).toBe('1.2万');
    expect(formatCompactNumber(120_000_000)).toBe('1.2亿');
    expect(formatCompactNumber(1500)).toBe('1.5千');
  });

  test('handles negatives and bigint strings', () => {
    expect(formatCompactNumber('-2500')).toBe('-2.5千');
    expect(formatCompactNumber('9223372036854775807')).toMatch(/亿|千|万|\d/);
  });

  test('null and invalid', () => {
    expect(formatCompactNumber(null)).toBe('—');
    expect(formatCompactNumber('n/a')).toBe('—');
  });
});

describe('formatExactNumber', () => {
  test('groups digits', () => {
    expect(formatExactNumber(1234567)).toBe('1,234,567');
  });
});

describe('formatUnknownMetric', () => {
  test('null shows 还没有', () => {
    expect(formatUnknownMetric(null)).toBe('还没有');
    expect(formatUnknownMetric('100')).toBe('100');
  });
});

describe('video play vs online display', () => {
  test('view count ignores online lower bound raw', () => {
    const viewCount = '12345678';
    const onlineRaw = '1000+';
    expect(formatViewCountDisplay(viewCount)).toBe(formatCompactNumber(viewCount));
    expect(formatViewCountDisplay(viewCount)).not.toContain('+');
    expect(formatOnlineViewersDisplay(null, onlineRaw)).toBe('1千+');
    expect(formatViewCountDisplay(viewCount)).not.toBe(formatOnlineViewersDisplay(null, onlineRaw));
  });
});
