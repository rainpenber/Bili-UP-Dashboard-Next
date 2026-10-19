import { describe, expect, test } from 'bun:test';
import { partitionNameFromLabels } from '@studio/db';
import { parseView } from './bilibili-parse';

describe('partition names from a view payload', () => {
  test('keeps tid values and does not invent a name when both labels are empty', () => {
    const view = parseView({
      code: 0,
      data: {
        bvid: 'BV1jHnn63EEi',
        cid: 1,
        pubdate: 1_720_000_000,
        title: '实测',
        owner: { mid: 2, name: 'UP' },
        tid: 95,
        tid_v2: 2102,
        tname: '',
        tname_v2: '',
        stat: { view: 1, danmaku: 0, reply: 0, favorite: 0, coin: 0, share: 0, like: 0 },
      },
    });
    expect(view.tid).toBe(95);
    expect(view.tidV2).toBe(2102);
    expect(view.tname).toBe('');
    expect(view.tnameV2).toBe('');
    expect(partitionNameFromLabels(view.tnameV2, view.tname)).toBeNull();
  });

  test('rejects placeholder labels and keeps a real newer name', () => {
    expect(partitionNameFromLabels('', '未知')).toBeNull();
    expect(partitionNameFromLabels('  其他  ', '动画')).toBe('动画');
    expect(partitionNameFromLabels('知识', '')).toBe('知识');
    expect(partitionNameFromLabels('', '  科技  ')).toBe('科技');
  });
});
