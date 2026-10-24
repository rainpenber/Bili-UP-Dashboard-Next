import { describe, expect, test } from 'bun:test';
import { parseCreatorCard, parseCreatorSpaceAccInfo } from './creator-profile';

describe('creator profile parsers', () => {
  test('parses web-interface card face and name', () => {
    const profile = parseCreatorCard(
      {
        code: 0,
        data: {
          card: {
            mid: 496445222,
            name: '狐正正',
            face: 'http://i0.hdslb.com/bfs/face/a.jpg',
          },
        },
      },
      '496445222',
    );
    expect(profile).toEqual({
      mid: '496445222',
      uname: '狐正正',
      faceUrl: 'https://i0.hdslb.com/bfs/face/a.jpg',
    });
  });

  test('parses space acc/info fallback', () => {
    const profile = parseCreatorSpaceAccInfo(
      {
        code: 0,
        data: {
          mid: '240240',
          name: 'GOAT前进',
          face: 'https://i1.hdslb.com/bfs/face/b.jpg',
        },
      },
      '240240',
    );
    expect(profile.uname).toBe('GOAT前进');
    expect(profile.faceUrl).toContain('hdslb.com');
  });
});
