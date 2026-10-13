import { describe, expect, test } from 'bun:test';
import { parseMetricCsvWithStaging } from './metric-parse';

describe('invalid numeric cells', () => {
  test('rejects views row with unparseable 播放量', () => {
    const csv = `时间,播放量,在线观看人数,点赞,投币,收藏,分享,弹幕
2025-01-01 10:00,bad,50,1,0,0,0,0`;
    const { stagingRows, issues, samples } = parseMetricCsvWithStaging({
      kind: 'views',
      entityKey: 'BVTEST',
      text: csv,
      sourceTimezone: 'Asia/Shanghai',
    });
    expect(samples.length).toBe(0);
    expect(stagingRows.length).toBe(1);
    expect(stagingRows[0]?.qualityFlags).toContain('invalid_numeric');
    expect(issues.some((i) => i.message === 'invalid numeric cell')).toBe(true);
  });
});
