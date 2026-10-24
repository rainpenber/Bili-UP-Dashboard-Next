import { describe, expect, test } from 'bun:test';
import {
  deriveBiliAccountExpiryState,
  parseCreateBiliAccountRequest,
  parsePatchBiliAccountRequest,
} from './bili-accounts';

describe('bili account contracts', () => {
  test('derives expiry states', () => {
    const now = new Date('2026-10-23T00:00:00Z');
    expect(
      deriveBiliAccountExpiryState({
        status: 'revoked',
        secretPresent: true,
        cookieExpiresAt: null,
        now,
      }),
    ).toBe('revoked');
    expect(
      deriveBiliAccountExpiryState({
        status: 'active',
        secretPresent: false,
        cookieExpiresAt: null,
        now,
      }),
    ).toBe('missing_secret');
    expect(
      deriveBiliAccountExpiryState({
        status: 'expired',
        secretPresent: true,
        cookieExpiresAt: null,
        now,
      }),
    ).toBe('expired');
    expect(
      deriveBiliAccountExpiryState({
        status: 'active',
        secretPresent: true,
        cookieExpiresAt: new Date('2026-10-20T00:00:00Z'),
        now,
      }),
    ).toBe('expired');
    expect(
      deriveBiliAccountExpiryState({
        status: 'active',
        secretPresent: true,
        cookieExpiresAt: new Date('2026-10-28T00:00:00Z'),
        now,
      }),
    ).toBe('expiring_soon');
    expect(
      deriveBiliAccountExpiryState({
        status: 'active',
        secretPresent: true,
        cookieExpiresAt: new Date('2026-12-01T00:00:00Z'),
        now,
      }),
    ).toBe('ok');
  });

  test('parses create and patch bodies', () => {
    expect(parseCreateBiliAccountRequest({ cookie: 'SESSDATA=x; DedeUserID=1' }).cookie).toContain(
      'SESSDATA',
    );
    expect(() => parseCreateBiliAccountRequest({ cookie: '  ' })).toThrow();
    expect(parsePatchBiliAccountRequest({ isDefault: true })).toEqual({ isDefault: true });
    expect(() => parsePatchBiliAccountRequest({})).toThrow();
  });
});
