import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLegacyFollowerCsv, parseLegacyVideoCsv } from './legacy-import';

const repoRoot = join(import.meta.dir, '../../..');

describe('legacy csv parser', () => {
  test('reads BOM, CRLF, Shanghai minutes, and leaves comments unparsed', () => {
    const text = `\uFEFF时间,播放量,在线观看人数,点赞,投币,收藏,分享,弹幕\r\n2026-04-25 22:01,88,1234+,13,10,2,0,1\r\nbad,x,1,1,1,1,1,1\r\n`;
    const parsed = parseLegacyVideoCsv(text);
    expect(parsed.total).toBe(2);
    expect(parsed.rejected).toBe(1);
    expect(parsed.rows).toHaveLength(1);
    const row = parsed.rows[0];
    expect(row?.sampledAt.toISOString()).toBe('2026-04-25T14:01:00.000Z');
    expect(row?.rawTime).toBe('2026-04-25 22:01');
    expect(row?.viewCount).toBe(88n);
    expect(row?.onlineViewers).toBe(1234n);
    expect(row?.onlineViewersRaw).toBe('1234+');
    expect(row && 'commentCount' in row).toBe(false);
  });

  test('parses a real legacy sample and is stable across repeats', () => {
    const views = readFileSync(
      join(repoRoot, 'reference/legacy-collector/samples/BV11A7fzTEti_views.csv'),
      'utf8',
    );
    const followers = readFileSync(
      join(repoRoot, 'reference/legacy-collector/samples/1030924321_follower.csv'),
      'utf8',
    );
    const video = parseLegacyVideoCsv(views);
    const again = parseLegacyVideoCsv(views);
    expect(video.rows[0]?.sampledAt.toISOString()).toBe('2025-05-13T10:09:00.000Z');
    expect(video.rows[0]?.sampledAt.toISOString()).toBe(again.rows[0]?.sampledAt.toISOString());
    expect(video.rejected).toBe(0);
    const fans = parseLegacyFollowerCsv(followers);
    expect(fans.rows[0]?.sampledAt.toISOString()).toBe('2026-04-25T14:01:00.000Z');
    expect(fans.rows[0]?.followerCount).toBe(34221n);
    expect(fans.rejected).toBe(0);
  });

  test('duplicate minutes in one file count as conflicts, not two rows', () => {
    const text = '时间,粉丝数\n2026-04-25 22:01,10\n2026-04-25 22:01,11\n';
    const parsed = parseLegacyFollowerCsv(text);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.rows[0]?.followerCount).toBe(10n);
  });
});
