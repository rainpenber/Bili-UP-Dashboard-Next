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
    expect(videoCardPlayText(metrics)).not.toContain('下界');
    expect(videoCardOnlineText(metrics)).toContain('下界');

    const summary = formatVideoCardMetricsSummary(metrics);
    expect(summary).toMatch(/^播放 .+ · 在线 .+$/);
    expect(summary).toContain(formatCompactNumber('12345678'));
    expect(summary).toContain('下界');
    expect(summary.indexOf('下界')).toBeGreaterThan(summary.indexOf('播放'));
  });

  test('summary keeps play and online segments distinct', () => {
    const metrics = {
      viewCount: '999',
      onlineViewers: '50',
      onlineViewersRaw: null,
    };
    const summary = formatVideoCardMetricsSummary(metrics);
    expect(summary).toBe('播放 999 · 在线 50');
  });
});
