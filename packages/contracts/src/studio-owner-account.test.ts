import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_STUDIO_OWNER_DISPLAY_NAME,
  DEFAULT_STUDIO_OWNER_MID,
  parseOnlyMineFlag,
  parseStudioOwnerAccount,
  parseStudioOwnerMid,
  parseUpdateStudioOwnerAccountRequest,
} from './studio-owner-account';

describe('studio owner account contracts', () => {
  test('accepts the default 狐正正 mid as a decimal string', () => {
    expect(parseStudioOwnerMid(DEFAULT_STUDIO_OWNER_MID)).toBe(DEFAULT_STUDIO_OWNER_MID);
    expect(DEFAULT_STUDIO_OWNER_DISPLAY_NAME).toBe('狐正正');
  });

  test('rejects illegal UID shapes without Number coercion', () => {
    expect(() => parseStudioOwnerMid('')).toThrow(/UID/);
    expect(() => parseStudioOwnerMid('  ')).toThrow(/UID/);
    expect(() => parseStudioOwnerMid('01')).toThrow(/UID/);
    expect(() => parseStudioOwnerMid('0')).toThrow(/UID/);
    expect(() => parseStudioOwnerMid('abc')).toThrow(/UID/);
    expect(() => parseStudioOwnerMid('3493141386627335.0')).toThrow(/UID/);
    expect(() => parseStudioOwnerMid('9223372036854775808')).toThrow(/范围/);
  });

  test('update body requires mid and displayName', () => {
    expect(
      parseUpdateStudioOwnerAccountRequest({
        mid: DEFAULT_STUDIO_OWNER_MID,
        displayName: '狐正正',
      }),
    ).toEqual({ mid: DEFAULT_STUDIO_OWNER_MID, displayName: '狐正正' });
    expect(() => parseUpdateStudioOwnerAccountRequest({ mid: '', displayName: 'x' })).toThrow(
      /UID/,
    );
    expect(() =>
      parseUpdateStudioOwnerAccountRequest({ mid: DEFAULT_STUDIO_OWNER_MID, displayName: '  ' }),
    ).toThrow(/显示名/);
    expect(() => parseUpdateStudioOwnerAccountRequest(null)).toThrow(/本人账号/);
  });

  test('onlyMine flag parsing', () => {
    expect(parseOnlyMineFlag(undefined)).toBe(false);
    expect(parseOnlyMineFlag('')).toBe(false);
    expect(parseOnlyMineFlag('0')).toBe(false);
    expect(parseOnlyMineFlag('false')).toBe(false);
    expect(parseOnlyMineFlag('1')).toBe(true);
    expect(parseOnlyMineFlag('true')).toBe(true);
    expect(() => parseOnlyMineFlag('yes')).toThrow(/只看我的/);
  });

  test('response parser keeps mid as string', () => {
    const parsed = parseStudioOwnerAccount({
      mid: DEFAULT_STUDIO_OWNER_MID,
      displayName: '狐正正',
      updatedAt: '2026-10-22T00:00:00.000Z',
    });
    expect(parsed.mid).toBe(DEFAULT_STUDIO_OWNER_MID);
    expect(typeof parsed.mid).toBe('string');
  });
});
