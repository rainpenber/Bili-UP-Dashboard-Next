import { describe, expect, test } from 'bun:test';
import {
  buildDynamicOption,
  buildFollowerOption,
  buildVideoEngagementOption,
  buildVideoViewsOption,
} from '@/lib/chart-config';
import type { ResolvedChartColors } from '@/lib/chart-colors';
import { formatViewCountThousandsFromRaw } from '@/lib/format-view-thousands';

const colors: ResolvedChartColors = {
  series: ['#111111', '#222222', '#333333', '#444444', '#555555'],
  foreground: '#111111',
  mutedForeground: '#666666',
  border: '#cccccc',
  background: '#ffffff',
};

describe('dual axis view scaling', () => {
  test('displays views in thousands while preserving raw', () => {
    const views = 2_345_678;
    const scaled = views / 1000;
    expect(scaled).toBe(2345.678);
    expect(views).toBe(Math.round(scaled * 1000));
  });

  test('tooltip thousand suffix matches dedicated formatter', () => {
    expect(formatViewCountThousandsFromRaw(999)).toBe('0.999');
    expect(formatViewCountThousandsFromRaw(10)).toBe('0.01');
  });

  test('chart legends and axes use everyday names', () => {
    const views = buildVideoViewsOption(['2024-01-01T00:00:00.000Z'], [10], [2000], colors, ['t']);
    const viewSeries = views.series as { name: string }[];
    expect(viewSeries.map((s) => s.name)).toEqual(['在线观看', '播放量']);
    const viewAxes = views.yAxis as { name: string }[];
    expect(viewAxes.map((axis) => axis.name)).toEqual(['在线观看', '播放量（千次）']);

    const engagement = buildVideoEngagementOption(
      ['2024-01-01T00:00:00.000Z'],
      [
        { name: '点赞', data: [1], color: '#111111' },
        { name: '投币', data: [1], color: '#222222' },
        { name: '收藏', data: [1], color: '#333333' },
        { name: '分享', data: [1], color: '#444444' },
        { name: '弹幕', data: [1], color: '#555555' },
        { name: '评论', data: [1], color: '#111111' },
      ],
      colors,
      ['t'],
    );
    const engagementSeries = engagement.series as { name: string }[];
    expect(engagementSeries.map((s) => s.name)).toEqual([
      '点赞',
      '投币',
      '收藏',
      '分享',
      '弹幕',
      '评论',
    ]);
    expect((engagement.yAxis as { name: string }).name).toBe('次数');

    const followers = buildFollowerOption(['2024-01-01T00:00:00.000Z'], [100], colors, ['t']);
    expect((followers.series as { name: string }[])[0]?.name).toBe('粉丝数');

    const dynamics = buildDynamicOption(
      ['2024-01-01T00:00:00.000Z'],
      [
        { name: '点赞', data: [1], color: '#111111' },
        { name: '转发', data: [1], color: '#222222' },
        { name: '评论', data: [1], color: '#333333' },
      ],
      colors,
      ['t'],
    );
    expect((dynamics.series as { name: string }[]).map((s) => s.name)).toEqual([
      '点赞',
      '转发',
      '评论',
    ]);

    const toolbox = views.toolbox as { feature?: { restore?: { title?: string } } };
    expect(toolbox.feature?.restore?.title).toBe('还原');
  });
});
