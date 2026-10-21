import { describe, expect, test } from 'bun:test';
import {
  datetimeLocalToOffsetIso,
  formatStartAtDisplay,
  offsetIsoToDatetimeLocal,
} from '@/lib/datetime-local';
import { parseMonitorStartAtInput } from '@studio/contracts';

describe('datetimeLocalToOffsetIso', () => {
  test('Asia/Shanghai keeps civil clock and passes contract parser', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'Asia/Shanghai';
    try {
      const offsetIso = datetimeLocalToOffsetIso('2026-11-01T09:30');
      expect(offsetIso).toBe('2026-11-01T09:30:00+08:00');
      expect(parseMonitorStartAtInput(offsetIso)).toBe('2026-11-01T01:30:00.000Z');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  test('America/Los_Angeles keeps civil clock with negative offset', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const offsetIso = datetimeLocalToOffsetIso('2026-11-01T09:30');
      expect(offsetIso).toBe('2026-11-01T09:30:00-08:00');
      expect(parseMonitorStartAtInput(offsetIso)).toBe('2026-11-01T17:30:00.000Z');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  test('rejects rolled calendar dates and empty junk', () => {
    expect(() => datetimeLocalToOffsetIso('2027-02-30T18:00')).toThrow(/合法/);
    expect(() => datetimeLocalToOffsetIso('not-a-time')).toThrow(/合法/);
    expect(() => datetimeLocalToOffsetIso('')).toThrow(/合法/);
  });
});

describe('offsetIsoToDatetimeLocal / formatStartAtDisplay', () => {
  test('round-trips local wall time and formats unset label', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'Asia/Shanghai';
    try {
      expect(offsetIsoToDatetimeLocal('2026-11-01T01:30:00.000Z')).toBe('2026-11-01T09:30');
      expect(formatStartAtDisplay(null)).toBe('未设置（立即开始）');
      expect(formatStartAtDisplay('2026-11-01T01:30:00.000Z')).toContain('2026');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
