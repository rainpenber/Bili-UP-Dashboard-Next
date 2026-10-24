import { describe, expect, test } from 'bun:test';
import {
  commercialSourceWindowFromPayload,
  extractCommercialSourceWindow,
  normalizeSourceWindowInstant,
  sourceWindowHasDates,
} from './commercial-source-window';

describe('commercial source window (WP-R2-22A)', () => {
  test('normalizes ISO and Shanghai date-only fields without inventing values', () => {
    expect(normalizeSourceWindowInstant('2025-09-18T00:00:00+08:00')).toBe(
      '2025-09-17T16:00:00.000Z',
    );
    expect(normalizeSourceWindowInstant('2025-09-18')).toBe('2025-09-17T16:00:00.000Z');
    expect(normalizeSourceWindowInstant('2025-10-21')).toBe('2025-10-20T16:00:00.000Z');
    expect(normalizeSourceWindowInstant(null)).toBeNull();
    expect(normalizeSourceWindowInstant('')).toBeNull();
    expect(normalizeSourceWindowInstant('not-a-date')).toBeNull();
    expect(normalizeSourceWindowInstant('2025-02-30')).toBeNull();
    expect(normalizeSourceWindowInstant(20250918)).toBeNull();
  });

  test('extracts only startAt / endAt / reminderAt from payload', () => {
    const window = extractCommercialSourceWindow({
      startAt: '2025-09-18',
      endAt: '2025-10-21',
      reminderAt: '2025-09-10T09:00:00+08:00',
      title: '海信E8S',
      chatSnippet: '客户原文不得外泄',
    });
    expect(window).toEqual({
      startAt: '2025-09-17T16:00:00.000Z',
      endAt: '2025-10-20T16:00:00.000Z',
      reminderAt: '2025-09-10T01:00:00.000Z',
    });
    expect(JSON.stringify(window)).not.toContain('客户');
    expect(JSON.stringify(window)).not.toContain('海信');
  });

  test('missing payload fields stay null; unbound projects stay null', () => {
    expect(extractCommercialSourceWindow({ title: '无档期' })).toEqual({
      startAt: null,
      endAt: null,
      reminderAt: null,
    });
    expect(commercialSourceWindowFromPayload(false, { startAt: '2025-09-18' })).toBeNull();
    expect(
      commercialSourceWindowFromPayload(true, { startAt: '2025-09-01', endAt: '2025-10-19' }),
    ).toEqual({
      startAt: '2025-08-31T16:00:00.000Z',
      endAt: '2025-10-18T16:00:00.000Z',
      reminderAt: null,
    });
    expect(sourceWindowHasDates(null)).toBe(false);
    expect(sourceWindowHasDates({ startAt: null, endAt: null, reminderAt: null })).toBe(false);
    expect(
      sourceWindowHasDates({
        startAt: '2025-09-17T16:00:00.000Z',
        endAt: null,
        reminderAt: null,
      }),
    ).toBe(true);
  });
});
