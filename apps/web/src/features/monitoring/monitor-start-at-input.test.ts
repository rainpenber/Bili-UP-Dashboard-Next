import { describe, expect, test } from 'bun:test';
import { datetimeLocalToOffsetIso } from '@/lib/datetime-local';
import { resolveOptionalVideoStartAt } from '@/features/monitoring/monitor-start-at-input';

describe('resolveOptionalVideoStartAt', () => {
  test('non-video and empty omit startAt', () => {
    expect(resolveOptionalVideoStartAt('creator', '2026-11-01T09:30')).toEqual({ ok: true });
    expect(resolveOptionalVideoStartAt('video', '')).toEqual({ ok: true });
    expect(resolveOptionalVideoStartAt('video', '   ')).toEqual({ ok: true });
  });

  test('valid local value returns offset ISO for the runtime zone', () => {
    expect(resolveOptionalVideoStartAt('video', '2026-11-01T09:30')).toEqual({
      ok: true,
      startAt: datetimeLocalToOffsetIso('2026-11-01T09:30'),
    });
  });

  test('illegal input returns readable error and does not yield startAt', () => {
    const bad = resolveOptionalVideoStartAt('video', '2027-02-30T18:00');
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('expected failure');
    expect(bad.message).toMatch(/合法|日历|时间/);
  });
});
