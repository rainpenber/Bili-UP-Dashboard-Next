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
              pic: 'http://i0.hdslb.com/bfs/archive/cover.jpg',
            },
          ],
        },
      },
    });
    expect(videos).toEqual([
      {
        bvid: 'BV1xx411c7mD',
        title: '示例',
        created: 1700000000n,
        mid: '123',
        pic: 'http://i0.hdslb.com/bfs/archive/cover.jpg',
      },
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
    expect(parsed.skips).toEqual([]);
    expect(parsed.items[0]).toEqual({
      dynamicId: '1063487284684259332',
      publishedAtSec: 1700000000n,
      title: '动态正文',
      text: '动态正文',
    });
  });

  test('parses AV dynamic archive bvid and leaves plain dynamics without it', () => {
    const parsed = parseSpaceDynamicFeed({
      code: 0,
      data: {
        has_more: false,
        items: [
          {
            id_str: '1063487284684259333',
            type: 'DYNAMIC_TYPE_AV',
            modules: {
              module_author: { pub_ts: 1700000004 },
              module_dynamic: {
                major: {
                  archive: {
                    bvid: 'BV1xx411c7mD',
                    title: '视频标题',
                  },
                },
              },
            },
          },
          {
            id_str: '1063487284684259334',
            type: 'DYNAMIC_TYPE_DRAW',
            modules: {
              module_author: { pub_ts: 1700000005 },
              module_dynamic: {
                desc: { text: '普通图文' },
                major: { draw: { items: [] } },
              },
            },
          },
          {
            id_str: '1063487284684259335',
            type: 'DYNAMIC_TYPE_AV',
            modules: {
              module_author: { pub_ts: 1700000006 },
              module_dynamic: {
                major: { archive: { bvid: 'not-a-bvid', title: '非法 bvid' } },
              },
            },
          },
        ],
      },
    });
    expect(parsed.items[0]?.bvid).toBe('BV1xx411c7mD');
    expect(parsed.items[0]?.title).toBe('视频标题');
    expect(parsed.items[1]?.bvid).toBeUndefined();
    expect(parsed.items[2]?.bvid).toBeUndefined();
  });

  test('isolates bad / only_fans items without failing the feed', () => {
    const parsed = parseSpaceDynamicFeed({
      code: 0,
      data: {
        has_more: false,
        items: [
          {
            id_str: '1001',
            type: 'DYNAMIC_TYPE_DRAW',
            modules: {
              module_author: { pub_ts: 1700000001 },
              module_dynamic: { desc: { text: '正常' } },
            },
          },
          {
            id_str: '1002',
            type: 'DYNAMIC_TYPE_DRAW',
            modules: {
              module_dynamic: {
                major: { only_fans: { price: 1 } },
              },
            },
          },
          {
            id_str: 'not-a-number',
            modules: { module_author: { pub_ts: 1 } },
          },
          {
            id_str: '1003',
            modules: {
              module_author: { pub_ts: 1700000003 },
              module_dynamic: { desc: { text: '另一条' } },
            },
          },
        ],
      },
    });
    expect(parsed.items.map((i) => i.dynamicId)).toEqual(['1001', '1003']);
    expect(parsed.skips).toHaveLength(2);
    expect(parsed.skips[0]?.externalId).toBe('1002');
    expect(parsed.skips[0]?.reason).toContain('only_fans');
  });
});
