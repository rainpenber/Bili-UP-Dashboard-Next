import { describe, expect, test } from 'bun:test';
import { formatCompactNumber } from '@/lib/format-compact-number';
import {
  formatVideoCardMetricsSummary,
  videoCardOnlineText,
  videoCardPlayText,
} from '@/features/monitoring/video-card-metrics';

describe('video card metrics summary', () => {
  test('播放 uses viewCount even when onlineViewersRaw is a lower bound', () => {
    const metrics = {
      viewCount: '12345678',
      onlineViewers: null,
      onlineViewersRaw: '1000+',
    };

    expect(videoCardPlayText(metrics)).toBe(formatCompactNumber('12345678'));
    expect(videoCardPlayText(metrics)).not.toContain('+');
    expect(videoCardOnlineText(metrics)).toBe('1千+');

    const summary = formatVideoCardMetricsSummary(metrics);
    expect(summary).toMatch(/^播放量 .+ · 在线观看 .+$/);
    expect(summary).toContain(formatCompactNumber('12345678'));
    expect(summary).toContain('1千+');
    expect(summary.indexOf('1千+')).toBeGreaterThan(summary.indexOf('播放量'));
    expect(summary.indexOf('在线观看')).toBeGreaterThan(summary.indexOf('播放量'));
  });

  test('summary keeps play and online segments distinct', () => {
    const metrics = {
      viewCount: '999',
      onlineViewers: '50',
      onlineViewersRaw: null,
    };
    const summary = formatVideoCardMetricsSummary(metrics);
    expect(summary).toBe('播放量 999 · 在线观看 50');
  });
});
