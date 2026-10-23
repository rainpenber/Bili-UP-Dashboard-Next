import { describe, expect, test } from 'bun:test';
import { extractWbiKeysFromNav, mixinWbiKey, signWbiParams } from './wbi';

describe('wbi signing', () => {
  test('extracts keys from nav and signs sorted query', () => {
    const keys = extractWbiKeysFromNav({
      code: 0,
      data: {
        wbi_img: {
          img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
          sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
        },
      },
    });
    expect(keys.imgKey).toBe('7cd084941338484aae1ad9425b84077c');
    expect(keys.subKey).toBe('4932caff0ff746eab6f01bf08b70ac45');
    const mixin = mixinWbiKey(keys.imgKey, keys.subKey);
    expect(mixin).toHaveLength(32);
    const signed = signWbiParams({ foo: '114', bar: '514', zab: '1919810' }, mixin, 1702204169);
    expect(signed.wts).toBe(1702204169);
    expect(signed.w_rid).toMatch(/^[a-f0-9]{32}$/);
    expect(signed.query.w_rid).toBe(signed.w_rid);
  });
});
