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

describe('dynamic bvid extraction across major variants', () => {
  const parseBvid = (major: unknown, descText?: string): string | undefined => {
    const parsed = parseSpaceDynamicFeed({
      code: 0,
      data: {
        has_more: false,
        items: [
          {
            id_str: '2001',
            modules: {
              module_author: { pub_ts: 1700000000 },
              module_dynamic: {
                ...(descText ? { desc: { text: descText } } : {}),
                major,
              },
            },
          },
        ],
      },
    });
    return parsed.items[0]?.bvid;
  };

  test('reads major.archive.bvid', () => {
    expect(parseBvid({ archive: { bvid: 'BV1xx411c7mD' } })).toBe('BV1xx411c7mD');
  });

  test('reads bvid from major.opus.jump_url', () => {
    expect(
      parseBvid({
        opus: { jump_url: 'https://www.bilibili.com/video/BV1xx411c7mD?share_source=copy' },
      }),
    ).toBe('BV1xx411c7mD');
  });

  test('reads bvid from major.draw.items[0].jump_url', () => {
    expect(
      parseBvid({
        draw: { items: [{ jump_url: 'https://www.bilibili.com/video/BV1xx411c7mD' }] },
      }),
    ).toBe('BV1xx411c7mD');
  });

  test('reads bvid from deeply nested major.opus.attach_card.url', () => {
    expect(
      parseBvid({
        opus: { attach_card: { url: 'https://www.bilibili.com/video/BV1xx411c7mD' } },
      }),
    ).toBe('BV1xx411c7mD');
  });

  test('prefers a bvid-named field over an earlier url match', () => {
    expect(
      parseBvid({
        draw: {
          items: [
            {
              jump_url: 'https://www.bilibili.com/video/BV1yy411c7mE',
              bvid: 'BV1xx411c7mD',
            },
          ],
        },
      }),
    ).toBe('BV1xx411c7mD');
  });

  test('ignores bvid that only appears in desc.text', () => {
    expect(parseBvid({ draw: { items: [] } }, '提到了 BV1xx411c7mD 但不是投稿')).toBeUndefined();
  });

  test('rejects invalid or truncated bvid', () => {
    expect(parseBvid({ archive: { bvid: 'BV1xx411c7m' } })).toBeUndefined();
    expect(
      parseBvid({ opus: { jump_url: 'https://www.bilibili.com/video/BV1xx411c7m' } }),
    ).toBeUndefined();
    expect(parseBvid({ opus: { bvid: 'not-a-bvid' } })).toBeUndefined();
  });

  test('returns no bvid for plain image-text dynamics', () => {
    expect(
      parseBvid({ draw: { items: [{ src: 'https://i0.hdslb.com/bfs/new_dyn/a.jpg' }] } }),
    ).toBeUndefined();
  });
});

describe('dynamic bvid extraction from desc jump urls', () => {
  const parseDesc = (desc: Record<string, unknown>, major?: unknown): string | undefined => {
    const parsed = parseSpaceDynamicFeed({
      code: 0,
      data: {
        has_more: false,
        items: [
          {
            id_str: '3001',
            modules: {
              module_author: { pub_ts: 1700000000 },
              module_dynamic: {
                desc,
                ...(major === undefined ? {} : { major }),
              },
            },
          },
        ],
      },
    });
    return parsed.items[0]?.bvid;
  };

  test('reads bvid from desc.rich_text_nodes[0].jump_url', () => {
    expect(
      parseDesc({
        text: '转发视频',
        rich_text_nodes: [
          {
            type: 'RICH_TEXT_NODE_TYPE_VIDEO',
            jump_url: 'https://www.bilibili.com/video/BV1xx411c7mD',
          },
        ],
      }),
    ).toBe('BV1xx411c7mD');
  });

  test('reads bvid from desc.jump_url', () => {
    expect(
      parseDesc({ text: '看看这个', jump_url: 'https://www.bilibili.com/video/BV1xx411c7mD' }),
    ).toBe('BV1xx411c7mD');
  });

  test('ignores bvid that only appears in desc.text without jump_url', () => {
    expect(parseDesc({ text: '提到了 BV1xx411c7mD 但没有跳转' })).toBeUndefined();
  });

  test('prefers major bvid over desc jump_url', () => {
    expect(
      parseDesc(
        {
          text: '正文',
          jump_url: 'https://www.bilibili.com/video/BV1yy411c7mE',
          rich_text_nodes: [{ jump_url: 'https://www.bilibili.com/video/BV1zz411c7mF' }],
        },
        { archive: { bvid: 'BV1xx411c7mD', title: '视频标题' } },
      ),
    ).toBe('BV1xx411c7mD');
  });
});
