import { describe, expect, test } from 'bun:test';
import { formatCompactNumber, formatExactNumber } from '@/lib/format-compact-number';
import {
  formatVideoCardMetricsSummary,
  formatVideoGridMetricsLine,
  formatVideoGridPlayText,
  formatVideoGridUpdateText,
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

describe('video grid metrics line', () => {
  test('play text uses compact plus exact value', () => {
    expect(formatVideoGridPlayText('13631')).toBe(
      `${formatCompactNumber('13631')} (${formatExactNumber('13631')}) 播放`,
    );
    expect(formatVideoGridPlayText('13631')).toBe('1.4万 (13,631) 播放');
    expect(formatVideoGridPlayText('999')).toBe('999 播放');
    expect(formatVideoGridPlayText(null)).toBe('— 播放');
  });

  test('metrics line appends online when present', () => {
    expect(
      formatVideoGridMetricsLine({
        viewCount: '13631',
        onlineViewers: '12',
        onlineViewersRaw: null,
      }),
    ).toBe('1.4万 (13,631) 播放 · 在线 12');
    expect(
      formatVideoGridMetricsLine({
        viewCount: '13631',
        onlineViewers: null,
        onlineViewersRaw: '1000+',
      }),
    ).toBe(
      `1.4万 (13,631) 播放 · 在线 ${videoCardOnlineText({ viewCount: null, onlineViewers: null, onlineViewersRaw: '1000+' })}`,
    );
    expect(
      formatVideoGridMetricsLine({
        viewCount: '13631',
        onlineViewers: null,
        onlineViewersRaw: null,
      }),
    ).toBe('1.4万 (13,631) 播放');
  });

  test('update text is YYYY-MM-DD HH:mm local', () => {
    expect(formatVideoGridUpdateText(null)).toBe('暂无');
    const text = formatVideoGridUpdateText('2026-10-21T00:00:00.000Z');
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
