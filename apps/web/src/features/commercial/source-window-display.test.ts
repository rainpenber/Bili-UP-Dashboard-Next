import { describe, expect, test } from 'bun:test';
import {
  formatSourceWindowRange,
  sourceWindowCardCopy,
  sourceWindowOriginLabel,
} from './source-window-display';

describe('source window display (WP-R2-22A)', () => {
  test('formats Hisense / DJI-style ranges without implying confirmation', () => {
    expect(
      formatSourceWindowRange({
        startAt: '2025-09-17T16:00:00.000Z',
        endAt: '2025-10-20T16:00:00.000Z',
        reminderAt: null,
      }),
    ).toBe('9月18日–10月21日');
    expect(
      formatSourceWindowRange({
        startAt: '2025-08-31T16:00:00.000Z',
        endAt: '2025-10-18T16:00:00.000Z',
        reminderAt: null,
      }),
    ).toBe('9月1日–10月19日');
    expect(formatSourceWindowRange({ startAt: null, endAt: null, reminderAt: null })).toBeNull();
  });

  test('card copy distinguishes unbound, empty, and ranged sources', () => {
    expect(sourceWindowOriginLabel('hermes.wechat')).toBe('微信商单源');
    expect(sourceWindowOriginLabel('other.ns')).toBe('商单源');
    expect(sourceWindowCardCopy(null, null)).toEqual({ kind: 'none' });
    expect(
      sourceWindowCardCopy({ startAt: null, endAt: null, reminderAt: null }, 'hermes.real'),
    ).toEqual({ kind: 'empty', originLabel: '微信商单源' });
    expect(
      sourceWindowCardCopy(
        {
          startAt: '2025-09-17T16:00:00.000Z',
          endAt: '2025-10-20T16:00:00.000Z',
          reminderAt: null,
        },
        'hermes.wechat',
      ),
    ).toEqual({
      kind: 'range',
      rangeLabel: '9月18日–10月21日',
      originLabel: '微信商单源',
    });
  });
});
