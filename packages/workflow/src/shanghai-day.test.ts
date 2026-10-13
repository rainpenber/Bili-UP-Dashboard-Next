import { describe, expect, test } from 'bun:test';
import { shanghaiDayBounds } from './shanghai-day';

describe('shanghai day bounds', () => {
  test('uses Asia/Shanghai midnight for UTC evening instant', () => {
    const instant = new Date('2026-06-14T18:00:00.000Z');
    const { start, end } = shanghaiDayBounds(instant);
    expect(start.toISOString()).toBe('2026-06-14T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-15T16:00:00.000Z');
  });
});
