import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDynamicDetail } from './bilibili-dynamic';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/dynamic');
const DRAW_ID = '967717348014293017';
const FORWARD_ID = '966692349750018048';

function loadFixture(name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`夹具不是对象: ${name}`);
  }
  return parsed as Record<string, unknown>;
}

function cloneFixture(name: string): Record<string, unknown> {
  return structuredClone(loadFixture(name));
}

function itemOf(payload: Record<string, unknown>): Record<string, unknown> {
  const data = payload.data as Record<string, unknown>;
  return data.item as Record<string, unknown>;
}

function modulesOf(payload: Record<string, unknown>): Record<string, unknown> {
  return itemOf(payload).modules as Record<string, unknown>;
}

function statOf(payload: Record<string, unknown>): Record<string, unknown> {
  return modulesOf(payload).module_stat as Record<string, unknown>;
}

describe('dynamic detail fixtures', () => {
  test('labels document-derived and synthesized fixtures as offline, not live captures', () => {
    const draw = loadFixture('detail-draw.json')._fixture as { origin: string; note: string };
    const forward = loadFixture('detail-forward.json')._fixture as { origin: string; note: string };
    expect(draw.origin).toBe('document-derived');
    expect(forward.origin).toBe('test-synthesized');
    expect(draw.note).toContain('不是真实实测响应');
    expect(forward.note).toContain('不是真实实测响应');
    expect(draw.note).not.toContain('线上抓包');
    expect(forward.note).not.toContain('线上抓包');
  });
});

describe('parseDynamicDetail', () => {
  test('reads the documented draw sample without using the comment oid or album id', () => {
    const detail = parseDynamicDetail(loadFixture('detail-draw.json'), DRAW_ID);
    expect(detail.dynamicId).toBe(DRAW_ID);
    expect(detail.dynamicId).not.toBe('326122895');
    expect(detail.dynamicType).toBe('DYNAMIC_TYPE_DRAW');
    expect(detail.visible).toBe(true);
    expect(detail.authorMid).toBe('645769214');
    expect(detail.authorName).toBe('Session小胡');
    expect(detail.faceUrl).toContain('77906db03b1eefac02613de184afad03f7bc58d7.jpg');
    expect(detail.publishedAt?.toISOString()).toBe(new Date(1_724_152_653 * 1000).toISOString());
    expect(detail.publishedText).toBe('2024年08月20日 19:17');
    expect(detail.text).toBe(
      '今天因为Linux被骂, 决定放弃支持 Windows. 而且明天要开始军训了, 将停更若干时间, 遂发此动态, 望不知.',
    );
    expect(detail.majorType).toBe('MAJOR_TYPE_DRAW');
    expect(detail.likeCount).toBe(65n);
    expect(detail.commentCount).toBe(34n);
    expect(detail.repostCount).toBe(2n);
    expect(typeof detail.likeCount).toBe('bigint');
  });

  test('ignores a different avatar.mid and keeps module_author.mid', () => {
    const payload = cloneFixture('detail-draw.json');
    const author = modulesOf(payload).module_author as Record<string, unknown>;
    author.avatar = { mid: '1' };
    expect(parseDynamicDetail(payload, DRAW_ID).authorMid).toBe('645769214');
  });

  test('keeps a long dynamic id as a string', () => {
    const payload = cloneFixture('detail-draw.json');
    const longId = '967717348014293017000000000001';
    itemOf(payload).id_str = longId;
    const detail = parseDynamicDetail(payload, longId);
    expect(detail.dynamicId).toBe(longId);
    expect(detail.dynamicId).not.toBe(String(Number(longId)));
  });

  test('accepts a decimal string for a count above the safe integer range', () => {
    const payload = cloneFixture('detail-draw.json');
    const stat = statOf(payload);
    (stat.like as Record<string, unknown>).count = '9007199254740993';
    const detail = parseDynamicDetail(payload, DRAW_ID);
    expect(detail.likeCount).toBe(9007199254740993n);
    expect(detail.likeCount?.toString()).toBe('9007199254740993');
  });

  test('rejects an unsafe number count instead of rounding it', () => {
    const payload = cloneFixture('detail-draw.json');
    (statOf(payload).like as Record<string, unknown>).count = Number.MAX_SAFE_INTEGER + 2;
    expect(() => parseDynamicDetail(payload, DRAW_ID)).toThrow(/不是安全非负整数/);
  });

  test('rejects a negative, fractional, or non-numeric count', () => {
    for (const count of [-1, 1.5, '1.5', '1e2', true, '-1']) {
      const payload = cloneFixture('detail-draw.json');
      (statOf(payload).forward as Record<string, unknown>).count = count;
      expect(() => parseDynamicDetail(payload, DRAW_ID)).toThrow(/不是(安全)?非负整数/);
    }
  });

  test('keeps a real zero and leaves a missing count null', () => {
    const payload = cloneFixture('detail-draw.json');
    const stat = statOf(payload);
    (stat.like as Record<string, unknown>).count = 0;
    delete stat.comment;
    (stat.forward as Record<string, unknown>).count = null;
    const detail = parseDynamicDetail(payload, DRAW_ID);
    expect(detail.likeCount).toBe(0n);
    expect(detail.commentCount).toBeNull();
    expect(detail.repostCount).toBeNull();
  });

  test('a stat object without count is missing, not zero', () => {
    const payload = cloneFixture('detail-draw.json');
    statOf(payload).comment = { forbidden: false };
    expect(parseDynamicDetail(payload, DRAW_ID).commentCount).toBeNull();
  });

  test('accepts a string zero and a string author mid', () => {
    const payload = cloneFixture('detail-draw.json');
    (statOf(payload).like as Record<string, unknown>).count = '0';
    (modulesOf(payload).module_author as Record<string, unknown>).mid = '645769214';
    const detail = parseDynamicDetail(payload, DRAW_ID);
    expect(detail.likeCount).toBe(0n);
    expect(detail.authorMid).toBe('645769214');
  });

  test('uses the forward item stats and text, not the original post', () => {
    const detail = parseDynamicDetail(loadFixture('detail-forward.json'), FORWARD_ID);
    expect(detail.dynamicId).toBe(FORWARD_ID);
    expect(detail.dynamicId).not.toBe('939874290505875465');
    expect(detail.dynamicType).toBe('DYNAMIC_TYPE_FORWARD');
    expect(detail.authorMid).toBe('10001');
    expect(detail.authorName).toBe('合成转发者');
    expect(detail.text).toBe('转发附言，不是原帖正文');
    expect(detail.majorType).toBeNull();
    expect(detail.likeCount).toBe(3088n);
    expect(detail.commentCount).toBe(88n);
    expect(detail.repostCount).toBe(12n);
  });

  test('does not accept the original id when the current id differs', () => {
    const payload = cloneFixture('detail-forward.json');
    itemOf(payload).id_str = '966692349750018049';
    expect(() => parseDynamicDetail(payload, '939874290505875465')).toThrow('动态 id 与请求不一致');
  });

  test('does not substitute comment_id_str when id_str is absent', () => {
    const payload = cloneFixture('detail-draw.json');
    delete itemOf(payload).id_str;
    expect(() => parseDynamicDetail(payload, '326122895')).toThrow('动态详情缺少 id_str');
  });

  test('rejects a numeric id_str so a long id cannot lose precision', () => {
    const payload = cloneFixture('detail-draw.json');
    itemOf(payload).id_str = Number(DRAW_ID);
    expect(() => parseDynamicDetail(payload, DRAW_ID)).toThrow(
      '动态详情的 id_str 必须是十进制整数字符串',
    );
  });

  test('rejects a mismatched id_str', () => {
    const payload = cloneFixture('detail-draw.json');
    itemOf(payload).id_str = '967717348014293018';
    expect(() => parseDynamicDetail(payload, DRAW_ID)).toThrow('动态 id 与请求不一致');
  });

  test('fails when data or item is missing', () => {
    expect(() => parseDynamicDetail({ code: 0, data: null }, DRAW_ID)).toThrow('动态详情缺少 data');
    expect(() => parseDynamicDetail({ code: 0, data: {} }, DRAW_ID)).toThrow('动态详情缺少 item');
    expect(() => parseDynamicDetail({ code: 0, data: { item: null } }, DRAW_ID)).toThrow(
      '动态详情缺少 item',
    );
    expect(() => parseDynamicDetail(null, DRAW_ID)).toThrow('动态详情不是对象');
  });

  test('an unknown type may omit metadata, but identity still has to match', () => {
    const detail = parseDynamicDetail(
      {
        code: 0,
        data: {
          item: {
            id_str: DRAW_ID,
            type: 'DYNAMIC_TYPE_NOT_IN_FIXTURE',
            modules: {
              module_stat: {
                like: { count: 1 },
              },
            },
          },
        },
      },
      DRAW_ID,
    );
    expect(detail.dynamicType).toBe('DYNAMIC_TYPE_NOT_IN_FIXTURE');
    expect(detail.authorMid).toBeNull();
    expect(detail.authorName).toBeNull();
    expect(detail.text).toBeNull();
    expect(detail.majorType).toBeNull();
    expect(detail.likeCount).toBe(1n);
    expect(detail.commentCount).toBeNull();
    expect(detail.repostCount).toBeNull();
    expect(detail.visible).toBeNull();
    expect(detail.publishedAt).toBeNull();
  });

  test('rejects an unsafe author mid and a malformed module_stat', () => {
    const unsafeMid = cloneFixture('detail-draw.json');
    (modulesOf(unsafeMid).module_author as Record<string, unknown>).mid =
      Number.MAX_SAFE_INTEGER + 2;
    expect(() => parseDynamicDetail(unsafeMid, DRAW_ID)).toThrow(/module_author\.mid/);

    const badStat = cloneFixture('detail-draw.json');
    modulesOf(badStat).module_stat = '88';
    expect(() => parseDynamicDetail(badStat, DRAW_ID)).toThrow('module_stat 格式不正确');
  });

  test('rejects a dynamic id that is not a decimal string before parsing', () => {
    for (const dynamicId of ['', '0', '01', '12.0', '-1', ' 1', '1e2', 'abc']) {
      expect(() => parseDynamicDetail(loadFixture('detail-draw.json'), dynamicId)).toThrow(
        '动态 id 必须是十进制整数字符串',
      );
    }
  });
});
