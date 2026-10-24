import { describe, expect, test } from 'bun:test';
import { formatCompactNumber, formatExactNumber } from '@/lib/format-compact-number';
import {
  formatVideoCardMetricsSummary,
  formatVideoGridMetricsLine,
  formatVideoGridPlayText,
  formatVideoGridUpdateText,
  peakOnlineFromSamples,
  videoCardOnlineText,
  videoCardPlayText,
} from '@/features/monitoring/video-card-metrics';

describe('peakOnlineFromSamples', () => {
  test('samples [120, 890, 300] → peak 890', () => {
    expect(peakOnlineFromSamples([120, 890, 300])).toBe(890);
    expect(
      videoCardOnlineText(
        { viewCount: null, onlineViewers: null, onlineViewersRaw: null },
        [120, 890, 300],
      ),
    ).toBe('890');
    expect(
      formatVideoCardMetricsSummary(
        { viewCount: '999', onlineViewers: null, onlineViewersRaw: null },
        [120, 890, 300],
      ),
    ).toBe('播放 999 · 7日峰值在线 890');
  });

  test('no samples → null / 无在线数据 (not 0)', () => {
    expect(peakOnlineFromSamples([])).toBeNull();
    expect(peakOnlineFromSamples([null, undefined, '', '1000+'])).toBeNull();
    expect(
      videoCardOnlineText({ viewCount: '1', onlineViewers: null, onlineViewersRaw: '1000+' }),
    ).toBe('无在线数据');
    expect(
      formatVideoCardMetricsSummary({
        viewCount: '1',
        onlineViewers: null,
        onlineViewersRaw: null,
      }),
    ).toContain('无在线数据');
    expect(
      formatVideoCardMetricsSummary({
        viewCount: '1',
        onlineViewers: null,
        onlineViewersRaw: null,
      }),
    ).not.toMatch(/(^|[^\d])0([^\d]|$)/);
  });
});

describe('video card metrics summary', () => {
  test('播放 uses viewCount; online uses peak label not lower bound', () => {
    const metrics = {
      viewCount: '12345678',
      onlineViewers: '50',
      onlineViewersRaw: '1000+',
    };

    expect(videoCardPlayText(metrics)).toBe(formatCompactNumber('12345678'));
    expect(videoCardPlayText(metrics)).not.toContain('下界');
    expect(videoCardOnlineText(metrics)).toBe('50');
    expect(videoCardOnlineText(metrics)).not.toContain('下界');

    const summary = formatVideoCardMetricsSummary(metrics);
    expect(summary).toBe(`播放 ${formatCompactNumber('12345678')} · 7日峰值在线 50`);
  });

  test('summary keeps play and peak online segments distinct', () => {
    const metrics = {
      viewCount: '999',
      onlineViewers: '50',
      onlineViewersRaw: null,
    };
    const summary = formatVideoCardMetricsSummary(metrics);
    expect(summary).toBe('播放 999 · 7日峰值在线 50');
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

  test('metrics line appends peak online when present', () => {
    expect(
      formatVideoGridMetricsLine({
        viewCount: '13631',
        onlineViewers: '12',
        onlineViewersRaw: null,
      }),
    ).toBe('1.4万 (13,631) 播放 · 7日峰值在线 12');
    expect(
      formatVideoGridMetricsLine({
        viewCount: '13631',
        onlineViewers: null,
        onlineViewersRaw: '1000+',
      }),
    ).toBe('1.4万 (13,631) 播放 · 无在线数据');
    expect(
      formatVideoGridMetricsLine({
        viewCount: '13631',
        onlineViewers: null,
        onlineViewersRaw: null,
      }),
    ).toBe('1.4万 (13,631) 播放 · 无在线数据');
  });

  test('update text is YYYY-MM-DD HH:mm local', () => {
    expect(formatVideoGridUpdateText(null)).toBe('暂无');
    const text = formatVideoGridUpdateText('2026-10-21T00:00:00.000Z');
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
