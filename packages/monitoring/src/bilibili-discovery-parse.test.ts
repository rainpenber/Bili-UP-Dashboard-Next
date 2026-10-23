import { describe, expect, test } from 'bun:test';
import { parseSpaceArcSearch, parseSpaceDynamicFeed } from './bilibili-discovery-parse';

describe('discovery list parsers', () => {
  test('parses space arc search vlist', () => {
    const videos = parseSpaceArcSearch({
      code: 0,
      data: {
        list: {
          vlist: [
            {
              bvid: 'BV1xx411c7mD',
              title: '示例',
              created: 1700000000,
              mid: 123,
            },
          ],
        },
      },
    });
    expect(videos).toEqual([
      { bvid: 'BV1xx411c7mD', title: '示例', created: 1700000000n, mid: '123' },
    ]);
  });

  test('parses space dynamic feed items', () => {
    const parsed = parseSpaceDynamicFeed({
      code: 0,
      data: {
        has_more: false,
        offset: 'abc',
        items: [
          {
            id_str: '1063487284684259332',
            modules: {
              module_author: { pub_ts: 1700000000, name: 'UP' },
              module_dynamic: { desc: { text: '动态正文' } },
            },
          },
        ],
      },
    });
    expect(parsed.hasMore).toBe(false);
    expect(parsed.offset).toBe('abc');
    expect(parsed.items[0]).toEqual({
      dynamicId: '1063487284684259332',
      publishedAtSec: 1700000000n,
      title: '动态正文',
    });
  });
});
